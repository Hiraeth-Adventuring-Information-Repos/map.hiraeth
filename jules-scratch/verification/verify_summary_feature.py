import asyncio
import json
from playwright.async_api import async_playwright, expect

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page()

        # Step 1: Navigate to the editor and prepare data
        await page.goto("http://localhost:8000/point-finder.html")

        # Create a dummy maps.json to upload
        map_data = [{
            "id": "test-map",
            "name": "Test Map",
            "imageUrl": "images/hiraeth-maps-preview.png",
            "width": 1024,
            "height": 768,
            "pointsOfInterest": [],
            "regions": [],
            "lines": []
        }]
        json_string = json.dumps(map_data)

        # Create a file in the browser's memory and attach it to the input
        await page.evaluate(
            """(json) => {
                const blob = new Blob([json], { type: 'application/json' });
                const file = new File([blob], 'maps.json', { type: 'application/json' });
                const dataTransfer = new DataTransfer();
                dataTransfer.items.add(file);
                const fileInput = document.getElementById('jsonFileInput');
                fileInput.files = dataTransfer.files;
                fileInput.dispatchEvent(new Event('change', { bubbles: true }));
            }""",
            json_string
        )

        # Step 2: Wait for UI to be ready, then load map
        await expect(page.locator("#subMapSelect")).to_be_enabled()
        await page.select_option("#subMapSelect", "test-map")
        await expect(page.locator("#loadSubMapBtn")).to_be_enabled()
        await page.click("#loadSubMapBtn")
        await expect(page.locator("#status")).to_contain_text("Loaded: Test Map")

        # Step 3: Add a point with summary and description
        await page.click("#map", position={"x": 300, "y": 200})
        await page.fill("#pointName", "Test Point")
        await page.select_option("#poiTypeSelect", "City")
        await page.fill("#pointDescription", "This is the full, detailed description of the test point.")
        await page.fill("#pointSummary", "This is the short summary.")
        await page.click("#addPointBtn")

        # Step 4: Export the generated JSON data
        await page.click("#exportMapDataBtn")
        await expect(page.locator(".json-modal-textarea")).to_be_visible()
        json_output = await page.locator(".json-modal-textarea").input_value()
        if not json_output.strip().startswith('['):
            json_output = f"[{json_output}]"
        await page.click(".json-modal-close")

        # Step 5: Intercept the data request on the main page
        await page.route(
            "**/maps/maps.json",
            lambda route: route.fulfill(
                status=200,
                content_type="application/json",
                body=json_output
            )
        )

        # Step 6: Navigate to the map viewer
        await page.goto("http://localhost:8000/index.html")

        # Step 7: Wait for the map to be fully loaded
        await expect(page.locator("#toggle-markers-btn")).to_be_visible(timeout=10000)

        # Step 8: Find the marker and open the popup
        marker_locator = page.locator(".leaflet-marker-icon")
        await expect(marker_locator).to_be_visible()
        await marker_locator.click()

        # Step 9: Verify the unexpanded state
        await expect(page.locator(".leaflet-popup-content-wrapper")).to_be_visible()
        summary_element = page.locator(".popup-summary p")
        await expect(summary_element).to_have_text("This is the short summary.")
        await page.screenshot(path="jules-scratch/verification/summary_unexpanded.png")

        # Step 10: Expand the popup and verify the full content
        await page.click(".popup-read-more")

        full_content_container = page.locator(".popup-full-content")
        await expect(full_content_container).to_be_visible()
        await expect(full_content_container).to_contain_text("This is the full, detailed description")

        await page.screenshot(path="jules-scratch/verification/summary_expanded.png")

        await browser.close()

if __name__ == "__main__":
    asyncio.run(main())