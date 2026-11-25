import os
import pytest
from dotenv import load_dotenv
from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.support.ui import WebDriverWait

load_dotenv()

def env(name, default=""):
    return os.getenv(name, default).strip()

@pytest.fixture
def driver():
    browser = env("BROWSER", "chrome").lower()
    headless = env("HEADLESS", "false").lower() in ("1", "true", "yes")
    if browser != "chrome":
        pytest.skip(f"Browser '{browser}' is not configured in this starter kit.")
    options = Options()
    if headless:
        options.add_argument("--headless=new")
    options.add_argument("--window-size=1440,1000")
    options.add_argument("--disable-notifications")
    options.add_argument("--no-sandbox")
    options.add_argument("--disable-dev-shm-usage")
    driver = webdriver.Chrome(options=options)
    driver.implicitly_wait(float(env("IMPLICIT_WAIT_SECONDS", "3")))
    yield driver
    driver.quit()

@pytest.fixture
def wait(driver):
    return WebDriverWait(driver, float(env("EXPLICIT_WAIT_SECONDS", "15")))

@pytest.fixture
def cfg():
    return {
        "login_url": env("LOGIN_URL"),
        "booking_url": env("BOOKING_URL"),
        "username": env("QA_USERNAME"),
        "password": env("QA_PASSWORD"),
        "login_username": env("SEL_LOGIN_USERNAME_CSS"),
        "login_password": env("SEL_LOGIN_PASSWORD_CSS"),
        "login_submit": env("SEL_LOGIN_SUBMIT_CSS"),
        "login_success": env("SEL_LOGIN_SUCCESS_CSS"),
        "venue": env("SEL_BOOKING_VENUE_CSS"),
        "date": env("SEL_BOOKING_DATE_CSS"),
        "start": env("SEL_BOOKING_START_CSS"),
        "end": env("SEL_BOOKING_END_CSS"),
        "submit": env("SEL_BOOKING_SUBMIT_CSS"),
        "error": env("SEL_BOOKING_ERROR_CSS"),
        "success": env("SEL_BOOKING_SUCCESS_CSS"),
        "venue_value": env("SEL_TEST_VENUE_VALUE"),
        "date_value": env("SEL_TEST_DATE", "2026-12-01"),
        "start_value": env("SEL_TEST_START", "09:00"),
        "end_value": env("SEL_TEST_END", "10:00"),
        "conflict_start": env("SEL_CONFLICT_START", "09:30"),
        "conflict_end": env("SEL_CONFLICT_END", "10:30"),
    }
