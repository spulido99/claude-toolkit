---
name: improve-campaign
description: Analyze campaign data and provide specific optimization recommendations to improve results.
allowed-tools:
  - Read
  - Write
  - Glob
  - AskUserQuestion
argument-hint: ""
---

# Improve Campaign Command

Analyze campaign performance data and provide actionable recommendations to improve results.

## Workflow

### Step 1: Load Campaign Data

Read `.claude/digital-marketing.local.md` to gather:
- Campaign strategy and objectives
- Published content history
- Analytics logs
- Any previous recommendations

If no campaign file exists, tell user to run `/define-campaign` first.

### Step 2: Analyze Performance

Review the analytics data and look for:

**Reach Analysis**:
- Is reach increasing, stable, or declining?
- Which posts got the most reach?
- What patterns emerge?

**Engagement Analysis**:
- Overall engagement rate trend
- Which content types get most engagement?
- Are comments meaningful or just emojis?

**Conversion Analysis** (if applicable):
- Click-through rates
- Conversion rates
- Cost per result (if running ads)

### Step 3: Identify Issues

Based on analysis, identify specific issues:

**Low Reach Issues**:
- Inconsistent posting schedule
- Wrong posting times
- Content format not optimized for algorithm
- Low engagement affecting distribution

**Low Engagement Issues**:
- Weak hooks/opening lines
- No clear call-to-action
- Content not resonating with audience
- Posting at wrong times

**Low Conversion Issues**:
- Weak offer
- Friction in the funnel
- Trust gap with audience
- Wrong audience targeting

### Step 4: Generate Recommendations

Create specific, actionable recommendations:

```markdown
## Campaign Improvement Recommendations

### Priority 1: Quick Wins (Do This Week)
1. **[Specific action]**
   - Why: [Reason based on data]
   - How: [Step-by-step instructions]
   - Expected impact: [What should improve]

2. **[Specific action]**
   - Why: [Reason]
   - How: [Instructions]
   - Expected impact: [Result]

### Priority 2: Short-term (Next 2 Weeks)
1. **[Action item]**
   - [Details]

2. **[Action item]**
   - [Details]

### Priority 3: Longer-term (Next Month)
1. **[Strategic recommendation]**
   - [Details]

### A/B Test Suggestions
Test these variables to find what works best:
1. **Hook styles**: Test question vs. bold statement vs. story opening
2. **CTA variations**: Test different calls-to-action
3. **Posting times**: Test morning vs. evening posts
4. **Content format**: Test carousel vs. single image vs. video

### Content Ideas Based on Performance
Your best performing content was about [topic]. Here are 5 related content ideas:
1. [Idea 1]
2. [Idea 2]
3. [Idea 3]
4. [Idea 4]
5. [Idea 5]
```

### Step 5: Create Improvement Versions

For underperforming content, offer improved versions:

**Original Post**:
[Show original]

**Improved Version**:
[Show improved version with stronger hook, clearer CTA, etc.]

**What Changed**:
- Stronger opening hook using [technique]
- Clearer call-to-action
- [Other changes]

### Step 6: Ask for Focus Area

Use AskUserQuestion to ask:
"Which area would you like to focus on improving?"
- Reach (getting seen by more people)
- Engagement (getting more interactions)
- Conversions (getting more clicks/sales)
- All of the above (comprehensive plan)

Then provide tailored recommendations for their focus.

### Step 7: Save Recommendations

Append recommendations to campaign file under "## Optimization Notes":

```markdown
## Optimization Notes

### [Date] - Analysis
**Focus Area**: [reach/engagement/conversion]
**Key Findings**:
- [Finding 1]
- [Finding 2]

**Actions Taken**:
- [ ] [Action 1] - Pending
- [ ] [Action 2] - Pending

**Next Review**: [Date in 1-2 weeks]
```

### Step 8: Offer Next Steps

Present options to user:
1. Generate improved content versions now
2. Create A/B test plan
3. Schedule next analytics check
4. Update campaign strategy

## Common Improvement Patterns

### If Reach is Low
- Increase posting frequency
- Use platform-preferred formats (Reels, Carousels)
- Post at peak audience times
- Improve engagement to boost algorithm favor

### If Engagement is Low
- Strengthen hooks (first line must stop scroll)
- Add clear CTAs to every post
- Ask questions to encourage comments
- Respond to all comments quickly

### If Conversions are Low
- Clarify the value proposition
- Add social proof (testimonials, results)
- Reduce friction (fewer steps to convert)
- Build more trust before asking for action

## Tone Guidelines

Be encouraging but honest:
- Celebrate what's working
- Frame problems as opportunities
- Provide specific, doable actions
- Avoid overwhelming with too many changes
- Focus on 1-3 priorities at a time
