
import pytest
from playwright.sync_api import sync_playwright
import os
import time

def test_point_finder_ui():
    """
    Verifies that point-finder.html loads correctly with the new UI elements,
    including the sidebar, toolbars, and that the map loads.
    """
    # Ensure test_map.json exists
    if not os.path.exists("test_map.json"):
        print("Creating test_map.json...")
        with open("test_map.json", "w") as f:
            f.write("""[
              {
                "id": "test_map",
                "name": "Test Map",
                "imageUrl": "https://via.placeholder.com/800x600.png",
                "width": 800,
                "height": 600,
                "pointsOfInterest": [],
                "regions": [],
                "lines": []
              }
            ]""")

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        # Determine absolute path to point-finder.html
        cwd = os.getcwd()
        file_url = f"file://{cwd}/point-finder.html"

        print(f"Loading {file_url}...")
        page.goto(file_url)

        # 1. Verify Title
        assert page.title() == "Map Editor Tool"
        print("Title verified.")

        # 2. Verify Sidebar Existence
        assert page.is_visible("#sidebar"), "Sidebar should be visible"
        print("Sidebar found.")

        # 3. Verify Mode Tabs
        assert page.is_visible(".mode-selector"), "Mode selector tabs should be visible"
        assert page.locator(".mode-tab").count() == 3, "Should have 3 mode tabs (Points, Regions, Lines)"
        print("Mode tabs verified.")

        # 4. Load JSON File
        print("Uploading test_map.json...")
        file_input = page.locator("#jsonFileInput")
        file_input.set_input_files("test_map.json")

        # Wait for the status text update
        try:
            page.wait_for_selector("#status:has-text('Manifest file loaded')", timeout=5000)
            print("JSON loaded status verified.")
        except Exception as e:
             status_text = page.inner_text("#status")
             print(f"Failed to find success status. Current status: '{status_text}'")
             raise e

        # 5. Load the Map from Selector
        page.select_option("#subMapSelect", value="test_map")
        # Click the "Load Map" button
        page.click("#loadSubMapBtn")

        # Wait for map loaded toast
        page.wait_for_selector("text=Map \"Test Map\" Loaded!", timeout=5000)
        print("Map loaded toast appeared.")

        # 6. Verify Toolbar Existence
        toolbar_count = page.locator(".text-toolbar").count()
        print(f"Found {toolbar_count} text toolbars.")
        assert toolbar_count > 0, "Text toolbars should be injected"

        # 7. Verify Tabs Switching
        # Switch to Regions
        page.click("div[data-mode='regions']")
        assert page.is_visible(".region-controls"), "Region controls should be visible after switching tab"
        assert not page.is_visible(".point-controls"), "Point controls should be hidden"

        # Switch to Lines
        page.click("div[data-mode='lines']")
        assert page.is_visible(".line-controls"), "Line controls should be visible after switching tab"

        # 8. Check Vertex Tools Visibility (Regression Test)
        # Ensure the buttons are present in the DOM.
        assert page.locator("#addVerticesBtn").count() == 1
        assert page.locator("#editVerticesBtn").count() == 1

        print("All UI checks passed.")
        browser.close()

if __name__ == "__main__":
    try:
        test_point_finder_ui()
        print("Test passed!")
    except Exception as e:
        print(f"Test failed: {e}")
        exit(1)
    finally:
        if os.path.exists("test_map.json"):
            os.remove("test_map.json")
