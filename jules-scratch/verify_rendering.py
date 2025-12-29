
import os
from playwright.sync_api import sync_playwright

def run(playwright):
    browser = playwright.chromium.launch(headless=True)
    page = browser.new_page()

    # Open localhost
    url = "http://localhost:8000/index.html"

    print(f"Navigating to {url}")
    page.goto(url)

    # Enable dark mode manually
    print("Enabling dark mode...")
    page.evaluate("document.body.classList.add('dark-theme')")

    # Hide the map container's map element to verify background
    # We want to see if the stars are visible when the map is not obstructing them
    # Actually, let's verify what the user sees (map + stars).
    # But if the map is opaque, we won't see stars.
    # The previous image was 'background-image' on #map.
    # Let's verify if #map has transparent background now.

    # Check map background color
    bg_color = page.evaluate("getComputedStyle(document.getElementById('map')).backgroundColor")
    print(f"Map background color: {bg_color}")

    # Hide the map tiles pane to reveal background if tiles are opaque
    # But let's first take a screenshot of the normal state
    page.wait_for_timeout(1000)
    page.screenshot(path="jules-scratch/stars_verification_final.png")
    print("Screenshot saved to jules-scratch/stars_verification_final.png")

    # Now let's try hiding the map div to see if stars are underneath (rendered)
    page.evaluate("document.getElementById('map').style.opacity = '0'")
    page.screenshot(path="jules-scratch/stars_rendering_check.png")
    print("Screenshot saved to jules-scratch/stars_rendering_check.png")

    browser.close()

with sync_playwright() as playwright:
    run(playwright)
