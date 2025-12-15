
from playwright.sync_api import sync_playwright
import os
import time

def verify_frontend():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        # Verify Point Finder
        print("Navigating to Point Finder...")
        page.goto("http://localhost:8000/point-finder.html")
        page.wait_for_selector("#sidebar", timeout=5000)
        page.screenshot(path="jules-scratch/verification/point-finder.png")
        print("Captured point-finder.png")

        # Verify Main Viewer
        print("Navigating to Main Viewer...")
        page.goto("http://localhost:8000/index.html")
        # Wait for map or sidebar to appear
        page.wait_for_selector("#sidebar", timeout=5000)
        page.screenshot(path="jules-scratch/verification/index.png")
        print("Captured index.png")

        browser.close()

if __name__ == "__main__":
    verify_frontend()
