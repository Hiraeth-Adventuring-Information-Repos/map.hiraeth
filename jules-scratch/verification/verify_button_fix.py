import asyncio
from playwright.async_api import async_playwright, expect

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page()

        await page.goto('http://localhost:8000/point-finder.html')

        # 1. Load map and switch to Regions tab
        await page.select_option('#mapFileSelect', 'maps/maps.json')
        await expect(page.locator('#subMapSelect')).to_be_enabled(timeout=15000)
        await page.select_option('#subMapSelect', 'main_continent')
        await expect(page.locator('#loadSubMapBtn')).to_be_enabled()
        await page.click('#loadSubMapBtn')
        await expect(page.locator('#startRegionBtn')).to_be_enabled()

        await page.click('div[data-mode="regions"]')
        await expect(page.locator('.region-controls')).not_to_have_class('hidden')

        # 2. Select a region to edit
        await page.select_option('#editRegionSelect', 'Aethelumbra')
        await expect(page.locator('#saveRegionChangesBtn')).to_be_visible()
        await expect(page.locator('#editVerticesBtn')).to_be_visible()

        # 3. Click "Edit Vertices" and verify button states
        await page.click('#editVerticesBtn')
        await expect(page.locator('#editVerticesBtn')).to_have_text('Stop Editing Vertices')
        await expect(page.locator('#saveRegionChangesBtn')).to_be_hidden()
        await expect(page.locator('#cancelRegionEditBtn')).to_be_hidden()
        await page.screenshot(path='jules-scratch/verification/verification_vertex_editing_state.png')

        # 4. Stop editing and verify button states have returned
        await page.click('#editVerticesBtn') # It now acts as the "Stop" button
        await expect(page.locator('#editVerticesBtn')).to_have_text('Edit Vertices')
        await expect(page.locator('#saveRegionChangesBtn')).to_be_visible()
        await expect(page.locator('#cancelRegionEditBtn')).to_be_visible()
        await page.screenshot(path='jules-scratch/verification/verification_standard_editing_state.png')

        await browser.close()

if __name__ == '__main__':
    asyncio.run(main())