from playwright.sync_api import sync_playwright, expect
import time

def verify_loading_indicator():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        # Load the page via HTTP to avoid CORS issues with fetch
        page.goto("http://localhost:8000/index.html")

        loader = page.locator("#loading-indicator")

        # Take a screenshot early
        page.screenshot(path="jules-scratch/verification/loading_state_early.png")

        # Wait for the loading indicator to be hidden
        # This might fail if the map loading fails (e.g., coming soon or error)
        # But we expect it to eventually hide based on our logic (finishLoading or error handler)
        expect(loader).to_be_hidden(timeout=10000)

        # Verify the map loaded (or sidebar populated)
        expect(page.locator("#map")).to_be_visible()

        # Take a final screenshot
        page.screenshot(path="jules-scratch/verification/loaded_state.png")

        browser.close()

if __name__ == "__main__":
    verify_loading_indicator()
