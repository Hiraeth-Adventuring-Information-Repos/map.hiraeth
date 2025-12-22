from playwright.sync_api import sync_playwright
import os
import time

def verify_folder_selection():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        # Start server
        import subprocess
        import sys
        server_process = subprocess.Popen([sys.executable, "-m", "http.server", "8000"], cwd=os.getcwd(), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        time.sleep(2)

        try:
            page.goto("http://localhost:8000/point-finder.html")

            # Wait for tree to load
            page.wait_for_selector("#server-map-tree .tree-list", timeout=5000)

            # Verify we have folders
            folders = page.locator(".tree-folder")
            if folders.count() == 0:
                print("No folders found!")
                return

            first_folder = folders.first
            folder_icon = first_folder.locator(".tree-folder-icon")
            folder_name = first_folder.locator(".tree-folder-name")

            print(f"Testing folder: {folder_name.text_content()}")

            # 1. Test Toggle (Click Icon)
            is_closed_initial = "closed" in first_folder.get_attribute("class")
            print(f"Initial state closed: {is_closed_initial}")

            folder_icon.click()
            time.sleep(0.5)

            is_closed_after = "closed" in first_folder.get_attribute("class")
            print(f"After icon click closed: {is_closed_after}")

            assert is_closed_initial != is_closed_after, "Icon click failed to toggle folder"

            # 2. Test Selection (Click Name)
            folder_name.click()

            # Check for active class
            assert "active" in folder_name.get_attribute("class"), "Folder name did not get active class on click"

            # Check if map loaded (Toast appears)
            try:
                page.wait_for_selector(".toast.success", timeout=2000)
                print("Map load toast appeared - Selection successful!")
            except:
                print("Map load toast did NOT appear.")
                pass

            page.screenshot(path="folder_selection_final.png")

        finally:
            server_process.terminate()
            browser.close()

if __name__ == "__main__":
    verify_folder_selection()
