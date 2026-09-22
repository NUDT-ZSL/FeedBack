"""Headless UI smoke test: render the page, apply an edit, exercise keep."""
from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={"width": 1280, "height": 800})
    page.goto("http://127.0.0.1:5071/")
    page.wait_for_selector(".comment-card")
    assert page.locator(".comment-card").count() == 3
    assert page.locator(".hl.resolved").count() == 3

    # replace two chars inside comment 1's anchor -> pending
    page.select_option("select[name=kind]", "replace")
    page.fill("input[name=pos]", "31")
    page.fill("input[name=length]", "2")
    page.fill("input[name=text]", "评论")
    page.click("button[type=submit]")
    page.wait_for_selector(".comment-card.pending")
    assert page.locator(".hl.pending").count() == 1

    # select the pending comment and keep it
    page.locator(".comment-card.pending").click()
    page.click("text=保留")
    page.wait_for_selector(".comment-card.pending", state="detached")
    assert page.locator(".hl.resolved").count() == 3

    page.screenshot(path="ui_screenshot.png", full_page=True)
    browser.close()
print("UI smoke test passed")
