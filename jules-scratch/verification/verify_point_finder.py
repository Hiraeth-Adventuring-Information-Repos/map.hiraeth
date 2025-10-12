import asyncio
from playwright.async_api import async_playwright, expect

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page()

        await page.goto('http://localhost:8000/point-finder.html')

        # 1. Switch to Regions tab
        await page.click('div[data-mode="regions"]')
        await expect(page.locator('.region-controls')).not_to_have_class('hidden')

        # 2. Load map data
        await page.select_option('#mapFileSelect', 'maps/maps.json')
        # Wait for a specific option to appear in the sub-map dropdown.
        await expect(page.locator('#subMapSelect option[value="main_continent"]')).to_be_visible(timeout=15000)
        await page.select_option('#subMapSelect', 'main_continent')
        await page.click('#loadSubMapBtn')

        # 3. Wait for UI to be ready and take screenshot
        await expect(page.locator('#startRegionBtn')).to_be_enabled()
        await expect(page.locator('#regionTypeInput')).to_be_visible()
        await expect(page.locator('#regionValueInput')).to_be_visible()
        await page.screenshot(path='jules-scratch/verification/verification_region_editor_ui.png')

        # 3. Create a new region
        await page.fill('#regionName', 'Test Kingdom')
        await page.fill('#regionTypeInput', 'Political')
        await page.fill('#regionValueInput', 'Test Kingdom')
        await page.click('#startRegionBtn')
        # Click some points on the map to create a polygon
        await page.locator('#map').click(position={'x': 200, 'y': 200})
        await page.locator('#map').click(position={'x': 300, 'y': 200})
        await page.locator('#map').click(position={'x': 250, 'y': 300})
        await page.click('#finishRegionBtn')

        # 4. View and verify the exported JSON
        await page.click('#exportMapDataBtn')
        await expect(page.locator('.json-modal-textarea')).to_be_visible()

        json_content = await page.locator('.json-modal-textarea').input_value()

        # Verify the new region's value field
        expect(json_content).to_contain('"value": "Test Kingdom"')
        # Verify the filterGroups generation
        expect(json_content).to_contain('"filterGroups"')
        expect(json_content).to_contain('"Regions"')
        expect(json_content).to_contain('"Political"')
        expect(json_content).to_contain('"Test Kingdom"')

        await page.screenshot(path='jules-scratch/verification/verification_json_export.png')

        await browser.close()

if __name__ == '__main__':
    asyncio.run(main())