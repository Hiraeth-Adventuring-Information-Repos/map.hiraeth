from playwright.sync_api import sync_playwright, expect

def run(playwright):
    browser = playwright.chromium.launch(headless=True)
    page = browser.new_page()
    page.goto("http://localhost:8000/index.html#carth-s=o")

    # Wait for the map to load by checking for the sidebar
    expect(page.locator("#sidebar")).to_be_visible(timeout=10000)

    # The 'carth' map has latLonBounds, so controls should be visible
    coords_control = page.locator(".coordinate-control")
    toggle_coords_btn = page.locator("#toggle-coords-btn")

    expect(coords_control).to_be_visible()
    expect(toggle_coords_btn).to_be_visible()

    # Test toggling visibility
    toggle_coords_btn.click()
    expect(coords_control).to_be_hidden()
    toggle_coords_btn.click()
    expect(coords_control).to_be_visible()

    # Test locking coordinates with a double click
    # Move mouse to a known position first
    page.mouse.move(500, 300)
    # Wait for a moment for the coordinate display to update
    page.wait_for_timeout(200)

    # Double click to lock the coordinates
    page.dblclick("#map")
    # Wait for the dblclick event handler to execute
    page.wait_for_timeout(200)

    # The dblclick itself might cause a final coordinate update.
    # So, we capture the text *after* the lock action. This is the value that should persist.
    locked_coords_text = coords_control.locator("span").inner_text()

    # Move the mouse to a different location
    page.mouse.move(600, 400)
    page.wait_for_timeout(200)

    # Assert that the coordinate text has NOT changed
    expect(coords_control.locator("span")).to_have_text(locked_coords_text)

    # Take a screenshot to visually verify the final state
    page.screenshot(path="jules-scratch/verification/verification.png")

    browser.close()

with sync_playwright() as playwright:
    run(playwright)
