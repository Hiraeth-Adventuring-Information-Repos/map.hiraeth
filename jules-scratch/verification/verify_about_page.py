
import asyncio
from playwright.async_api import async_playwright

async def run():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page()

        # Load the local HTML file
        import os
        cwd = os.getcwd()
        await page.goto(f'file://{cwd}/about.html')

        # 1. Take a screenshot of the whole page to verify the background fix and new section
        # We need to simulate a long page to test the min-height: 100vh fix
        await page.set_viewport_size({"width": 1280, "height": 800})

        # Toggle Dark Mode to test the background - Click the LABEL, not the input
        await page.click('.theme-switch')

        # Scroll to bottom
        await page.evaluate("window.scrollTo(0, document.body.scrollHeight)")

        # Add a short delay for smooth scroll/render
        await page.wait_for_timeout(500)

        await page.screenshot(path='jules-scratch/verification/about_page_dark.png', full_page=True)
        print("Screenshot saved to jules-scratch/verification/about_page_dark.png")

        # 2. Test the Embed Tool
        # Input a dummy URL
        test_url = "https://atlas.hiraeth.com/?view=10,10,5&poi=Castle&map=world-1"
        await page.fill('#embed-input', test_url)
        await page.click('#generate-embed-btn')

        # Check result
        result_text = await page.text_content('#embed-url')
        print(f"Input URL: {test_url}")
        print(f"Output URL: {result_text}")

        # Assertions
        assert "embed=true" in result_text, "Output should contain embed=true"
        assert "view=" not in result_text, "Output should NOT contain view parameter"
        assert "poi=Castle" in result_text, "Output SHOULD contain poi parameter"
        assert "map=world-1" in result_text, "Output SHOULD contain map parameter"

        await browser.close()

if __name__ == "__main__":
    asyncio.run(run())
