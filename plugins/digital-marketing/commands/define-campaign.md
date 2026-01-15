---
name: define-campaign
description: Interactive interview to define your marketing campaign strategy. Guides you through objectives, audience, budget, and platforms.
allowed-tools:
  - Read
  - Write
  - Glob
  - AskUserQuestion
argument-hint: "[campaign name]"
---

# Define Campaign Command

Guide the user through an interactive interview to define their marketing campaign strategy. Save the results to a local file for future reference.

## Workflow

### Step 1: Campaign Basics
Ask the user using AskUserQuestion:
1. **Campaign Name**: What should we call this campaign?
2. **Objective**: What's the main goal?
   - Awareness (get seen by more people)
   - Engagement (build community and interaction)
   - Conversion (drive sales, signups, or specific actions)

### Step 2: Target Audience
Ask the user:
1. **Who are you trying to reach?** (age, location, interests, profession)
2. **What problem do they have** that you solve?
3. **Where do they spend time online?** (which platforms)

### Step 3: Budget and Timeline
Ask the user:
1. **Budget range**:
   - Small ($0-500/month)
   - Medium ($500-2000/month)
   - Large ($2000+/month)
2. **Timeline**: When does the campaign start and for how long?

### Step 4: Platforms
Ask which platforms to focus on (can select multiple):
- Instagram
- Facebook
- LinkedIn
- Twitter/X
- TikTok

### Step 5: Content Language
Ask preferred language for content:
- English only
- Spanish only
- Both (bilingual)

### Step 6: Generate Strategy

Based on responses, generate a strategy document including:
- Campaign overview
- Target audience persona
- Recommended KPIs based on objective
- Content themes suggestions
- Posting frequency recommendations
- Budget allocation suggestions

### Step 7: Save to File

Save the complete strategy to `.claude/digital-marketing.local.md` in the current project directory.

Use this YAML frontmatter format:
```yaml
---
campaign_name: "[name]"
objective: "[awareness|engagement|conversion]"
audience: "[description]"
budget: "[range]"
platforms: ["platform1", "platform2"]
start_date: "[date]"
language: "[en|es|both]"
status: "planning"
---
```

Then include the full strategy document in markdown below the frontmatter.

## Important Notes

- Be encouraging and explain marketing concepts simply
- Provide examples when asking questions to help non-marketers understand
- If the user is unsure, offer recommendations based on best practices
- Always confirm the final strategy before saving
