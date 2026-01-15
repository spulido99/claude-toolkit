---
description: Generate a new LinkedIn post on an AI topic
argument-hint: [topic or idea]
allowed-tools: Read, Write, WebSearch
---

Generate a LinkedIn post for enterprise AI thought leadership.

**Topic/Idea provided:** $ARGUMENTS

## Process

1. **Understand the topic**
   - If topic is vague, use the linkedin-ai-strategy skill to identify the best angle
   - Map topic to one of the core areas: AI Adoption, AI Readiness, Org Structure for AI, AI at Scale, AI Strategy/Ethics, or AI Industry News

2. **Select format**
   - Ask user which format they prefer OR select based on topic:
     - Story-driven: For personal experiences, lessons learned
     - List/Framework: For actionable insights, best practices
     - Hot take: For contrarian views, strong opinions
     - News commentary: For reacting to current events

3. **Generate the post**
   - Write a compelling hook (first line must stop the scroll)
   - Keep length 150-300 words
   - Use short paragraphs (1-2 sentences each)
   - Include actionable insights
   - End with an engagement-driving CTA

4. **Apply brand voice**
   - Strategic advisor: Frame as business transformation guidance
   - Pragmatic executive: Ground in real-world implementation reality
   - Cross-industry perspective: Draw from diverse enterprise examples

5. **Present the post**
   - Show the complete post ready to copy
   - Highlight the hook separately
   - Suggest 2-3 alternative hooks
   - Recommend best posting time (weekday mornings, Tue-Thu optimal)

6. **Save to archive**
   - Append the generated post to `.claude/linkedin-ai-voice.local.md`
   - Include date, topic, and the full post
   - If file doesn't exist, create it with the template from the skill

## Quality Checklist

Before presenting, verify:
- [ ] Hook is specific (numbers, names, or curiosity gap)
- [ ] No generic openings ("In today's world...", "AI is transforming...")
- [ ] Post is 150-300 words
- [ ] Includes cross-industry perspective
- [ ] Has clear CTA at the end
- [ ] Voice blends strategic advisor + pragmatic executive
