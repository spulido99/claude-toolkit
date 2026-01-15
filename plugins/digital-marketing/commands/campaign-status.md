---
name: campaign-status
description: View a summary of your current campaign including strategy, content drafts, published posts, and recent analytics.
allowed-tools:
  - Read
  - Glob
argument-hint: ""
---

# Campaign Status Command

Display a comprehensive summary of the current campaign status.

## Workflow

### Step 1: Load Campaign File

Read `.claude/digital-marketing.local.md`.

If the file doesn't exist:
```
No campaign defined yet.

To get started, run `/define-campaign` to create your marketing strategy.
```

### Step 2: Parse Campaign Data

Extract information from the campaign file:

**From YAML Frontmatter**:
- campaign_name
- objective
- audience
- budget
- platforms
- start_date
- language
- status

**From Content Sections**:
- Strategy details
- Content drafts (pending)
- Published content
- Analytics logs
- Optimization notes

### Step 3: Generate Status Report

Create a clear, visual status report:

```markdown
# Campaign Status Report

## 📋 Campaign Overview
**Name**: [campaign_name]
**Status**: [Active/Planning/Paused]
**Started**: [start_date]
**Objective**: [objective] - [brief explanation]

## 🎯 Target Audience
[audience description]

## 💰 Budget
[budget range]
**Platforms**: [list of platforms]
**Content Language**: [language preference]

---

## 📝 Content Pipeline

### Drafts Ready to Post
| # | Platform | Type | Created | Status |
|---|----------|------|---------|--------|
| 1 | Instagram | Post | Jan 10 | Ready |
| 2 | LinkedIn | Post | Jan 11 | Ready |

### Recently Published
| Date | Platform | Performance |
|------|----------|-------------|
| Jan 8 | Instagram | 500 reach, 45 engagements |
| Jan 5 | Facebook | 320 reach, 28 engagements |

---

## 📊 Latest Metrics

**Last Check**: [date]

| Platform | Reach | Engagement | Trend |
|----------|-------|------------|-------|
| Instagram | 2.5K | 4.2% | ↑ |
| Facebook | 1.2K | 2.8% | → |

**Highlights**:
- [Key insight from recent analytics]
- [Notable achievement or concern]

---

## ✅ Recent Actions
- [Date]: [Action taken]
- [Date]: [Action taken]

## 🎯 Recommended Next Steps
1. [Most important action]
2. [Second priority]
3. [Third priority]
```

### Step 4: Provide Contextual Insights

Based on the data, add helpful context:

**If campaign is new (< 2 weeks)**:
"Your campaign is just getting started. Focus on consistent posting and building initial content."

**If engagement is trending up**:
"Great progress! Your engagement is improving. Keep doing what's working."

**If no recent posts**:
"You haven't posted in [X] days. Consistent posting helps maintain audience connection."

**If no analytics logged**:
"No recent analytics recorded. Run `/check-analytics` to see how you're performing."

**If drafts are waiting**:
"You have [X] content drafts ready. Consider posting with `/post-social`."

### Step 5: Quick Actions Menu

End with available actions:

```markdown
---

## Quick Actions

What would you like to do next?

- `/create-content` - Create new content
- `/post-social` - Post a draft to social media
- `/check-analytics` - Check latest performance
- `/improve-campaign` - Get optimization recommendations
- `/define-campaign` - Update campaign strategy
```

## Formatting Guidelines

- Use emojis sparingly for visual sections
- Keep tables clean and scannable
- Highlight important numbers
- Use clear status indicators (↑ up, ↓ down, → stable)
- Make it easy to see what needs attention

## No Data Scenarios

**No published content yet**:
"No posts published yet. Start with `/create-content` to generate your first post."

**No analytics yet**:
"No performance data recorded. After posting, run `/check-analytics` to track results."

**No drafts available**:
"Content pipeline is empty. Use `/create-content` to prepare posts."
