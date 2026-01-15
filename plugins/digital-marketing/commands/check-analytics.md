---
name: check-analytics
description: Open analytics dashboards and summarize campaign performance metrics in plain language.
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
  - mcp__claude-in-chrome__get_page_text
argument-hint: "--platform meta"
---

# Check Analytics Command

Navigate to analytics dashboards using Chrome and summarize metrics in plain language for non-marketers.

## Arguments

Parse from command:
- `--platform`: meta, google, instagram, facebook, linkedin, twitter, all (default: all from campaign)
- `--period`: 7d, 30d, 90d (default: 7d)

## Workflow

### Step 1: Get Browser Context

Call `mcp__claude-in-chrome__tabs_context_mcp` with `createIfEmpty: true`.
Create new tab if needed with `mcp__claude-in-chrome__tabs_create_mcp`.

### Step 2: Load Campaign Info

Read `.claude/digital-marketing.local.md` to know which platforms are being used.

### Step 3: Navigate to Analytics

Based on platform selection, open the appropriate dashboard:

---

#### Meta Business Suite (Instagram + Facebook)

**URL**: `https://business.facebook.com/latest/insights/overview`

1. Navigate to Meta Business Suite
2. Wait for page to load (may require login)
3. If login required, PAUSE and tell user
4. Look for the Insights overview section
5. Read the page content to extract:
   - Reach (last 7/30 days)
   - Content interactions
   - Followers count and change
   - Top performing posts
6. Navigate to Content section for post-level data if available
7. Take screenshot of key metrics

---

#### Google Analytics

**URL**: `https://analytics.google.com`

1. Navigate to Google Analytics
2. Wait for page to load
3. Look for key metrics:
   - Users (total visitors)
   - Sessions
   - Engagement rate
   - Traffic sources (especially Social)
4. If possible, filter by social traffic
5. Take screenshot of overview

---

#### Instagram Insights (via Instagram.com)

**URL**: `https://www.instagram.com/[username]` → Professional Dashboard

1. Navigate to user's Instagram profile
2. Look for "Professional dashboard" or "View insights" link
3. Click to access insights
4. Read:
   - Accounts reached
   - Accounts engaged
   - Total followers
5. Take screenshot

---

#### LinkedIn Analytics

**URL**: `https://www.linkedin.com/company/[company]/admin/analytics/`

1. Navigate to company page analytics
2. Read:
   - Post impressions
   - Unique visitors
   - Followers
3. Take screenshot

---

#### Twitter/X Analytics

**URL**: `https://analytics.twitter.com` or via Twitter settings

1. Navigate to Twitter Analytics
2. Look for:
   - Tweet impressions
   - Profile visits
   - Mentions
   - Follower growth
3. Take screenshot

---

### Step 4: Extract and Summarize Data

Read the page content using `get_page_text` or `read_page` to extract visible metrics.

Create a summary in plain language:

```markdown
## Analytics Summary - [Date]

### Overview
[1-2 sentence summary of overall performance]

### Key Numbers
- **People Reached**: [number] - [context: good/average/needs work]
- **Engagements**: [number] - [what this means]
- **New Followers**: [number] - [trend]
- **Link Clicks**: [number] (if applicable)

### What's Working
- [Observation about best performing content]
- [Pattern noticed]

### Areas to Improve
- [Specific suggestion]
- [Actionable recommendation]

### Plain English Translation
[2-3 sentences explaining what these numbers mean for someone new to marketing]
```

### Step 5: Save Analytics Log

Append to `.claude/digital-marketing.local.md` under "## Analytics Log":

```markdown
## Analytics Log

### [Date]
**Platforms Checked**: [list]
**Period**: [7d/30d]

**Meta Business Suite**:
- Reach: [number]
- Engagement: [number]
- Followers: [number]

**Google Analytics**:
- Users: [number]
- Social traffic: [number]

**Summary**: [brief insight]
```

### Step 6: Present to User

Display the summary to the user with:
- Key metrics in simple terms
- Comparison to previous period if available
- Specific recommendations
- What to do next

Ask if they want to:
1. See more details on any metric
2. Navigate to specific platform for deeper analysis
3. Get recommendations for improvement
4. Save and continue

## Plain Language Translations

Use these translations to explain metrics:

| Metric | Plain Explanation |
|--------|-------------------|
| Reach: 1,000 | "About 1,000 different people saw your content" |
| Impressions: 2,500 | "Your posts appeared on screens 2,500 times (some people saw multiple posts)" |
| Engagement Rate: 5% | "5 out of every 100 people who saw your content interacted with it - that's good!" |
| CTR: 2% | "2 out of every 100 people clicked your link - above average" |
| Follower Growth: +50 | "You gained 50 new followers this week" |

## Benchmarks for Context

Provide context using these benchmarks:

**Engagement Rate**:
- Below 1%: Needs improvement
- 1-3%: Average
- 3-6%: Good
- Above 6%: Excellent

**Reach vs Followers**:
- Below 10%: Algorithm limiting you
- 10-30%: Normal organic reach
- Above 30%: Content performing well

## Error Handling

**Not Logged In**:
"Please log into [platform] and let me know when ready."

**No Data Available**:
"I couldn't find analytics data. This could mean: 1) Account is too new, 2) No recent posts, 3) Different analytics location."

**Platform Changed Layout**:
"The platform layout seems different. Let me take a screenshot to see what's available."
