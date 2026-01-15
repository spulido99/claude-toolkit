---
name: post-social
description: Post content to social media using Chrome browser automation. Opens the platform and guides through the posting process.
allowed-tools:
  - Read
  - Write
  - Glob
  - AskUserQuestion
  - mcp__claude-in-chrome__tabs_context_mcp
  - mcp__claude-in-chrome__tabs_create_mcp
  - mcp__claude-in-chrome__navigate
  - mcp__claude-in-chrome__read_page
  - mcp__claude-in-chrome__find
  - mcp__claude-in-chrome__computer
  - mcp__claude-in-chrome__form_input
  - mcp__claude-in-chrome__get_page_text
argument-hint: "--platform instagram"
---

# Post Social Command

Automate posting content to social media platforms using Chrome browser automation.

## Arguments

Parse from command:
- `--platform`: instagram, facebook, linkedin, twitter, tiktok
- `--draft`: Use specific draft from campaign file (optional)

## Prerequisites

Before posting:
1. User must be logged into the platform in Chrome
2. Chrome browser with Claude extension must be running
3. Content must be ready (either from drafts or provided)

## Workflow

### Step 1: Get Browser Context

Call `mcp__claude-in-chrome__tabs_context_mcp` with `createIfEmpty: true` to get available tabs.

If no tab group exists, create a new tab with `mcp__claude-in-chrome__tabs_create_mcp`.

### Step 2: Load Content

Read `.claude/digital-marketing.local.md` to find saved content drafts.

If `--draft` specified, use that draft.
Otherwise, ask user which draft to post or if they want to enter new content.

### Step 3: Confirm Before Proceeding

Show the user:
- Platform to post to
- Content to be posted
- Any warnings about limitations

Ask: "Ready to open [platform] and create this post? You'll need to add images/videos manually."

Wait for explicit confirmation before proceeding.

### Step 4: Platform-Specific Posting

Execute the posting workflow for the selected platform:

---

#### Instagram Web

1. Navigate to `https://www.instagram.com`
2. Wait for page to load (2-3 seconds)
3. Find and click the "+" (Create) button using find tool
4. Select "Post" from the dropdown
5. PAUSE - Tell user: "Please select your image/video from your device. Let me know when you've uploaded it."
6. Wait for user confirmation
7. Click "Next" to proceed to filters (skip filters)
8. Click "Next" again to reach caption screen
9. Find the caption text area
10. Enter the caption text using form_input or computer type action
11. PAUSE - Ask user: "Caption entered. Ready to click Share?"
12. Wait for confirmation, then click "Share" button
13. Take screenshot for records
14. Update campaign file with published post

---

#### Facebook Web

1. Navigate to `https://www.facebook.com`
2. Wait for page to load
3. Find "What's on your mind?" composer
4. Click to open the post composer
5. Enter post text
6. PAUSE - If visual needed: "Add any photos/videos you want to include. Let me know when ready."
7. Wait for confirmation
8. PAUSE - Ask: "Ready to click Post?"
9. Click "Post" button
10. Take screenshot
11. Update campaign file

---

#### LinkedIn Web

1. Navigate to `https://www.linkedin.com/feed`
2. Wait for page to load
3. Find "Start a post" button
4. Click to open composer
5. Enter post text
6. PAUSE for media if needed
7. PAUSE - Confirm before posting
8. Click "Post" button
9. Take screenshot
10. Update campaign file

---

#### Twitter/X Web

1. Navigate to `https://twitter.com/home` or `https://x.com/home`
2. Wait for page to load
3. Find the tweet composer ("What is happening?!")
4. Click to focus
5. Enter tweet text (check under 280 chars)
6. PAUSE for media if needed
7. PAUSE - Confirm before posting
8. Click "Post" button
9. Take screenshot
10. Update campaign file

---

#### TikTok Web

1. Navigate to `https://www.tiktok.com/upload`
2. PAUSE - "TikTok requires you to upload a video. Please upload your video file."
3. Wait for user confirmation
4. Find caption field
5. Enter caption and hashtags
6. PAUSE - Confirm settings and posting
7. Click "Post" button
8. Take screenshot
9. Update campaign file

---

### Step 5: Update Campaign File

After successful posting, update `.claude/digital-marketing.local.md`:

1. Move content from "Content Drafts" to "Published Content"
2. Add timestamp and platform
3. Add link to post if visible
4. Update draft status to "published"

Format:
```markdown
## Published Content

### [Date] - [Platform]
[Content posted]
**URL**: [link if available]
**Status**: Published
```

### Step 6: Confirm Completion

Tell user:
- Post was published successfully
- Where to find it
- Reminder to engage with comments in first hour
- Suggest checking analytics in 24-48 hours

## Error Handling

**Login Required**:
"You need to be logged into [platform] in Chrome. Please log in and let me know when ready."

**Element Not Found**:
"I couldn't find the [element]. The platform may have updated. Let me take a screenshot to see what's on screen."

**Post Failed**:
"The post didn't go through. Let me check for error messages..."

## Important Safety Rules

- ALWAYS confirm with user before clicking any "Post", "Share", or "Publish" button
- NEVER post without explicit user approval
- If anything looks wrong, stop and ask the user
- Take screenshots at key steps for user verification
