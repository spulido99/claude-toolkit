---
description: Log and analyze post performance to improve future content
argument-hint: [post topic and engagement metrics]
allowed-tools: Read, Write
---

Track post performance and extract learnings for future content.

**Performance data:** $ARGUMENTS

## Engagement Analysis Process

1. **Collect metrics**
   Ask user for (if not provided):
   - Post topic/hook
   - Impressions
   - Reactions (likes)
   - Comments
   - Reposts/shares
   - Followers gained
   - Profile views

2. **Calculate engagement rate**
   ```
   Engagement Rate = (Reactions + Comments + Reposts) / Impressions * 100
   ```

   Benchmarks:
   - < 2%: Below average
   - 2-5%: Average
   - 5-10%: Good
   - > 10%: Excellent

3. **Analyze performance factors**

   **Hook effectiveness**
   - Did the hook use a proven pattern?
   - Was it specific (numbers, names)?
   - Did it create curiosity?

   **Content quality**
   - Was the insight actionable?
   - Did it align with brand voice?
   - Was length optimal (150-300 words)?

   **Format choice**
   - Was format appropriate for topic?
   - How did this format compare to previous posts?

   **Timing**
   - What day/time was it posted?
   - Did timing affect initial engagement?

   **Audience resonance**
   - Did comments show genuine interest?
   - What questions or debates emerged?
   - Who engaged (titles, industries)?

4. **Extract learnings**

   **What worked:**
   - [specific elements that drove engagement]

   **What didn't work:**
   - [elements that underperformed]

   **Hypotheses to test:**
   - [ideas for future experimentation]

5. **Update strategy recommendations**
   Based on this post and historical data:
   - Best performing formats
   - Best performing topics
   - Best performing hook patterns
   - Optimal posting times

6. **Save to archive**
   Update `.claude/linkedin-ai-voice.local.md`:
   - Add post to "Generated Posts" with performance notes
   - Update "Engagement Learnings" section
   - Adjust "Ideas Backlog" priority based on learnings

## Performance Tracking Template

```markdown
### [Date] - [Topic]
**Format**: [story/list/hot take/news]
**Hook**: [first line]

**Metrics**:
- Impressions: X
- Reactions: X
- Comments: X
- Reposts: X
- Engagement Rate: X%

**Learnings**:
- What worked: [specific element]
- What didn't: [specific element]
- Test next time: [hypothesis]
```
