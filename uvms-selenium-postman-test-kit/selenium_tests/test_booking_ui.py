import pytest
from selenium.webdriver.common.by import By
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.support.ui import Select

def required(cfg, *keys):
    missing = [key for key in keys if not cfg.get(key)]
    if missing:
        pytest.skip("Configure these .env values before running: " + ", ".join(missing))

def login(driver, wait, cfg):
    required(cfg, "login_url", "username", "password", "login_username",
             "login_password", "login_submit")
    driver.get(cfg["login_url"])
    wait.until(EC.visibility_of_element_located((By.CSS_SELECTOR, cfg["login_username"]))).send_keys(cfg["username"])
    driver.find_element(By.CSS_SELECTOR, cfg["login_password"]).send_keys(cfg["password"])
    driver.find_element(By.CSS_SELECTOR, cfg["login_submit"]).click()
    if cfg["login_success"]:
        wait.until(EC.visibility_of_element_located((By.CSS_SELECTOR, cfg["login_success"])))

def fill_booking(driver, cfg, start, end):
    required(cfg, "booking_url", "venue", "date", "start", "end", "submit", "venue_value")
    driver.get(cfg["booking_url"])
    venue = driver.find_element(By.CSS_SELECTOR, cfg["venue"])
    # Native <select> is supported. For custom dropdowns, adapt this helper.
    if venue.tag_name.lower() == "select":
        Select(venue).select_by_value(cfg["venue_value"])
    else:
        venue.click()
        venue.send_keys(cfg["venue_value"])
    date_el = driver.find_element(By.CSS_SELECTOR, cfg["date"])
    date_el.clear()
    date_el.send_keys(cfg["date_value"])
    start_el = driver.find_element(By.CSS_SELECTOR, cfg["start"])
    start_el.clear()
    start_el.send_keys(start)
    end_el = driver.find_element(By.CSS_SELECTOR, cfg["end"])
    end_el.clear()
    end_el.send_keys(end)
    driver.find_element(By.CSS_SELECTOR, cfg["submit"]).click()

def test_login_page_opens(driver, cfg):
    required(cfg, "login_url")
    driver.get(cfg["login_url"])
    assert driver.current_url.startswith(cfg["login_url"]), "Login page did not open"

def test_qa_user_can_log_in(driver, wait, cfg):
    login(driver, wait, cfg)
    if cfg["login_success"]:
        assert driver.find_element(By.CSS_SELECTOR, cfg["login_success"]).is_displayed()

def test_create_booking_and_then_reject_overlap(driver, wait, cfg):
    """
    End-to-end critical scenario:
    create 09:00-10:00, then attempt 09:30-10:30 for the same venue/date.
    Use a fresh QA venue/date/time for every run. Verify database state separately.
    """
    required(cfg, "login_url", "booking_url", "username", "password",
             "login_username", "login_password", "login_submit", "venue",
             "date", "start", "end", "submit", "error", "venue_value")
    login(driver, wait, cfg)

    fill_booking(driver, cfg, cfg["start_value"], cfg["end_value"])
    # The first request should be accepted. If the app uses a different success
    # message/flow, map SEL_BOOKING_SUCCESS_CSS or adapt this assertion.
    if cfg["success"]:
        wait.until(EC.visibility_of_element_located((By.CSS_SELECTOR, cfg["success"])))

    fill_booking(driver, cfg, cfg["conflict_start"], cfg["conflict_end"])
    conflict = wait.until(EC.visibility_of_element_located((By.CSS_SELECTOR, cfg["error"])))
    assert conflict.is_displayed(), "Expected a visible booking conflict message"
    message = (conflict.text or "").lower()
    assert any(word in message for word in ("conflict", "overlap", "unavailable", "booked", "occupied")), (
        f"Unexpected error text for conflict: {conflict.text!r}"
    )
