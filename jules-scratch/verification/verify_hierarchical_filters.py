import asyncio
from playwright.async_api import async_playwright, expect

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page()

        # Get the absolute path to the index.html file
        import os
        path = os.path.abspath('index.html')
        await page.goto(f'file://{path}')

        # Wait for the map to load
        await page.wait_for_selector('#map-list .map-item.active', timeout=60000)
        await page.wait_for_timeout(2000) # 2 seconds delay

        # 1. Open the filter panel
        await page.click('#toggle-filters-btn')
        await expect(page.locator('#poi-filter-container')).to_be_visible()

        # 2. Uncheck the "Political" group and take a screenshot
        political_group_checkbox = page.locator('#filter-region-group-Political')
        await political_group_checkbox.uncheck()
        await page.screenshot(path='jules-scratch/verification/verification_political_unchecked.png')

        # 3. Re-check the "Political" group
        await political_group_checkbox.check()

        # 4. Uncheck the "Kingdom" value and take a screenshot
        kingdom_checkbox = page.locator('#filter-region-value-Kingdom')
        await kingdom_checkbox.uncheck()
        await page.screenshot(path='jules-scratch/verification/verification_kingdom_unchecked.png')

        await browser.close()

if __name__ == '__main__':
    asyncio.run(main())