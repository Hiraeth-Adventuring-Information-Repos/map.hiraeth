
import asyncio
from playwright.async_api import async_playwright
import urllib.parse

async def run():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page()

        # Load the local HTML file
        import os
        cwd = os.getcwd()
        await page.goto(f'file://{cwd}/about.html')

        # Test the Embed Tool
        # Input a dummy URL with existing params including view
        test_url = "https://atlas.hiraeth.com/?view=10,10,5&poi=Castle&map=world-1"
        await page.fill('#embed-input', test_url)
        await page.click('#generate-embed-btn')

        # Check result
        result_text = await page.text_content('#embed-url')
        print(f"Input URL: {test_url}")
        print(f"Output URL: {result_text}")

        # Assertions
        assert "embed=true" in result_text, "Output should contain embed=true"

        # UPDATED ASSERTION: view parameter should now be preserved (expect encoding)
        # Note: URLSearchParams encodes commas as %2C
        assert "view=10%2C10%2C5" in result_text or "view=10,10,5" in result_text, "Output SHOULD contain view parameter"

        assert "poi=Castle" in result_text, "Output SHOULD contain poi parameter"
        assert "map=world-1" in result_text, "Output SHOULD contain map parameter"

        # Assertion: Check that embed=true is the FIRST parameter
        query_part = result_text.split('?')[1]
        assert query_part.startswith('embed=true'), f"embed=true should be the first parameter. Got: {query_part}"

        print("All assertions passed!")
        await browser.close()

if __name__ == "__main__":
    asyncio.run(run())
