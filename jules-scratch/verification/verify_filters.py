from playwright.sync_api import sync_playwright, Page, expect

def run(page: Page):
    """
    This test verifies that the map filtering functionality works as expected.
    """
    # 1. Arrange: Go to the running application.
    page.goto("http://localhost:8000")

    # Wait for the map to load by checking for the presence of the zoom control.
    expect(page.locator(".leaflet-control-zoom-in")).to_be_visible(timeout=15000)

    # 2. Act: Click the "Toggle Filters" button to open the filter panel.
    toggle_filters_btn = page.locator("#toggle-filters-btn")
    expect(toggle_filters_btn).to_be_visible()
    toggle_filters_btn.click()

    # 3. Assert: Verify the filter panel is visible.
    filter_panel = page.locator("#poi-filter-container")
    expect(filter_panel).to_be_visible()

    # 4. Act: Uncheck the "Political" filter.
    political_filter = page.get_by_label("Political")
    expect(political_filter).to_be_visible()
    political_filter.uncheck()

    # 5. Assert: Take a screenshot to verify that the political regions have been hidden.
    page.screenshot(path="jules-scratch/verification/political_filter_disabled.png")

    # 6. Act: Uncheck the "Geographic" filter.
    geographic_filter = page.get_by_label("Geographic")
    expect(geographic_filter).to_be_visible()
    geographic_filter.uncheck()

    # 7. Assert: Take another screenshot to verify that the geographic regions have been hidden.
    page.screenshot(path="jules-scratch/verification/all_filters_disabled.png")

    # 8. Act: Re-enable all filters
    toggle_all_filter = page.get_by_label("Show All / Hide All")
    expect(toggle_all_filter).to_be_visible()
    toggle_all_filter.check()

    # 9. Assert: Take a final screenshot to verify that all regions are visible again.
    page.screenshot(path="jules-scratch/verification/all_filters_enabled.png")

def main():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        run(page)
        browser.close()

if __name__ == "__main__":
    main()