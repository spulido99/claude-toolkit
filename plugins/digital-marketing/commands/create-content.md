---
name: create-content
description: Generate marketing content optimized for specific social media platforms. Creates copy in English, Spanish, or both.
allowed-tools:
  - Read
  - Write
  - Glob
  - AskUserQuestion
argument-hint: "--platform instagram --type post --language both"
---

# Create Content Command

Generate platform-optimized marketing content based on the user's campaign strategy.

## Arguments

Parse the following from the command arguments:
- `--platform`: instagram, facebook, linkedin, twitter, tiktok (default: ask user)
- `--type`: post, story, reel, ad, carousel (default: post)
- `--language`: en, es, both (default: from campaign settings or ask)

## Workflow

### Step 1: Load Campaign Strategy

Read the campaign strategy from `.claude/digital-marketing.local.md`.

If the file doesn't exist:
- Inform the user they should run `/define-campaign` first
- Or ask if they want to create content without a strategy (proceed with questions)

### Step 2: Gather Content Details

If platform not specified, ask the user which platform using AskUserQuestion.

Then ask:
1. **What's the main message or topic** for this content?
2. **What action do you want people to take** after seeing it? (engage, click link, buy, etc.)
3. **Any specific points or offers** to include?

### Step 3: Generate Content

Based on the platform, generate appropriate content:

**Instagram Post**:
- Hook (first line that stops the scroll)
- Body (2-3 short paragraphs)
- Call-to-action
- Hashtag suggestions (5-7 relevant hashtags)
- Caption length: 125-150 words optimal

**Facebook Post**:
- Engaging opening
- Main message
- Call-to-action
- Keep under 100 words for best engagement

**LinkedIn Post**:
- Professional hook
- Value-driven body with insights
- Clear CTA
- 3-5 relevant hashtags
- Can be longer (150-300 words)

**Twitter/X**:
- Concise message under 280 characters
- Thread option for longer content
- 1-2 hashtags max

**TikTok Caption**:
- Short, punchy caption
- Trending hashtags
- Hook for the video concept

### Step 4: Bilingual Content

If language is "both" or "es":
- Generate Spanish version (not literal translation)
- Adapt cultural references and tone
- Use neutral Latin American Spanish

Format bilingual content as:
```
🇺🇸 ENGLISH
[English content]

---

🇪🇸 ESPAÑOL
[Spanish content]
```

### Step 5: Present for Approval

Show the generated content to the user with:
- The content for each language
- Platform-specific formatting notes
- Suggested image/visual description
- Best posting times for the platform

Ask if they want to:
1. Approve and save as draft
2. Make edits (provide specific changes)
3. Generate alternative version
4. Change platform or content type

### Step 6: Save Draft

If approved, append to the campaign file under "## Content Drafts" section:

```markdown
## Content Drafts

### [Platform] - [Date Created]
**Status**: Draft
**Type**: [post/story/reel/ad]

[Content here]

**Suggested Visual**: [description]
**Hashtags**: [if applicable]
```

## Content Guidelines

Follow these platform best practices:

**Instagram**:
- First line is crucial (hook)
- Line breaks for readability
- Emojis enhance engagement
- End with clear CTA

**Facebook**:
- Personal, conversational tone
- Questions drive comments
- Native video outperforms links

**LinkedIn**:
- Professional but personal
- Share insights and learnings
- Thought leadership works well
- Mention relevant professionals with @

**Twitter**:
- Concise and punchy
- Numbers and lists work
- Controversy (tasteful) drives engagement
- Threads for complex topics

**TikTok**:
- Trend-aware
- Casual, authentic tone
- Hook in first second of video
- Trending sounds important
