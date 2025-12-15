
import os
import re
from playwright.sync_api import sync_playwright, expect

def verify_enhanced_features():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        # Load the local HTML file
        file_url = f"file://{os.path.abspath('point-finder.html')}"
        print(f"Loading {file_url}")
        page.goto(file_url)

        # 1. Verify Layout
        page.wait_for_selector(".leaflet-container")
        expect(page.locator(".sidebar")).to_be_visible()
        expect(page.locator("#sidebarToggle")).to_be_visible()

        # 2. Verify Collapsible Sidebar
        sidebar = page.locator("#sidebar")

        # Click toggle
        page.click("#sidebarToggle")
        page.wait_for_timeout(1000) # Increased Wait

        # Check if collapsed class added.
        expect(sidebar).to_have_class(re.compile(r"collapsed"))

        # Click toggle again to expand
        page.click("#sidebarToggle")
        page.wait_for_timeout(1000)
        expect(sidebar).not_to_have_class(re.compile(r"collapsed"))

        print("Sidebar toggle verified.")

        # 3. Verify Text Formatting Toolbar
        test_map_path = os.path.abspath("test_map.json")
        with open(test_map_path, 'r') as f:
            json_content = f.read()

        page.evaluate(f"""
            const data = {json_content};
            masterMapData = data;
            populateSubMapSelector(masterMapData);
            loadMap(data[0]);
        """)

        # Wait for load
        expect(page.locator("#status")).to_contain_text("Loaded: Test Map")

        # Ensure we are in "Points" mode (default)
        page.click(".mode-tab[data-mode='points']")

        # Check if .point-controls is visible
        point_controls = page.locator(".point-controls")
        expect(point_controls).not_to_have_class(re.compile(r"hidden"))

        # Now verify toolbar
        toolbar = page.locator(".text-toolbar").first

        expect(toolbar).to_be_visible()

        # Check buttons
        expect(toolbar.locator("button", has_text="B")).to_be_visible()
        expect(toolbar.locator("button", has_text="I")).to_be_visible()

        # Test Toolbar functionality
        textarea = page.locator("#pointDescription")
        textarea.fill("Hello World")
        # Select "World" (indices 6-11)
        textarea.evaluate("el => el.setSelectionRange(6, 11)")

        # Click Bold button
        toolbar.locator("button", has_text="B").click()

        # Check value
        expect(textarea).to_have_value("Hello <b>World</b>")
        print("Toolbar formatting verified.")

        # 4. Verify Toast Notification
        # Click map to set coords (use force=True if needed)
        page.click("#map", position={"x": 200, "y": 200}, force=True)

        # Fill details
        page.fill("#pointName", "Test Point")
        page.select_option("#poiTypeSelect", "City")

        # Click Add
        page.click("#addPointBtn")

        # Check for toast
        toast = page.locator(".toast.success")
        expect(toast).to_be_visible()
        expect(toast).to_contain_text("Point Added")
        print("Toast notification verified.")

        # 5. Verify Vertex Editing Buttons Visibility
        # Switch to Region Mode
        page.click(".mode-tab[data-mode='regions']")

        # Mock creating a region in data and loading it for edit
        page.evaluate("""
            collectedRegions.push({
                name: "Test Region",
                coordinates: [[0,0], [0,10], [10,10], [10,0]],
                type: "political",
                value: "Test"
            });
            updateRegionsOutput();
            loadRegionForEditing("Test Region");
        """)

        # Now check if the vertex tools container is visible
        vertex_tools_container = page.locator("#region-vertex-tools")

        # It should be visible
        expect(vertex_tools_container).to_be_visible()

        # And check buttons are visible
        expect(page.locator("#addVerticesBtn")).to_be_visible()
        expect(page.locator("#editVerticesBtn")).to_be_visible()

        print("Vertex editing tools visibility verified.")

        # Take final screenshot
        page.screenshot(path="jules-scratch/verification/enhanced_ui_v7.png")
        print("Final screenshot saved.")

        browser.close()

if __name__ == "__main__":
    verify_enhanced_features()
