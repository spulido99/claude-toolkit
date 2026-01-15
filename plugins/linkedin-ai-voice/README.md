# LinkedIn AI Voice

Become a LinkedIn Top Voice on AI with this comprehensive content creation toolkit. Generate high-engagement enterprise AI posts, research trends, optimize drafts, and track performance.

## Features

- **Content Generation**: Create LinkedIn posts with proven hooks and structures
- **Content Optimization**: Analyze and improve drafts for maximum engagement
- **Trend Research**: Stay current with AI news, Twitter/X discussions, and industry reports
- **Content Calendar**: Plan your weekly posting strategy
- **Idea Brainstorming**: Generate post ideas across multiple formats
- **Engagement Tracking**: Log and analyze post performance

## Installation

```bash
# Option 1: Test locally
claude --plugin-dir /path/to/linkedin-ai-voice

# Option 2: Copy to your plugins directory
cp -r linkedin-ai-voice ~/.claude/plugins/
```

## Commands

| Command | Description |
|---------|-------------|
| `/generate-post [topic]` | Create a new LinkedIn post on an AI topic |
| `/optimize-post [draft]` | Analyze and improve an existing draft |
| `/content-calendar [theme]` | Plan your weekly content calendar |
| `/post-ideas [theme]` | Brainstorm post ideas across formats |
| `/analyze-engagement [metrics]` | Log and analyze post performance |
| `/research-trends` | Research current AI news and hot topics |

## Brand Voice

This plugin is configured for a **Strategic Advisor + Pragmatic Executive** voice:

- **Strategic Advisor**: Frames AI as business transformation, anticipates executive questions
- **Pragmatic Executive**: Grounded in real implementations, cuts through hype

## Topic Focus Areas

1. AI Adoption in Enterprise
2. AI Readiness for Organizations
3. Organization Structure for AI
4. AI at Scale
5. AI Strategy/Ethics
6. AI Industry News

## Content Storage

The plugin stores your content archive at `.claude/linkedin-ai-voice.local.md`:

```markdown
---
last_updated: YYYY-MM-DD
posts_generated: N
---

# LinkedIn AI Voice - Content Archive

## Ideas Backlog
- [idea 1]
- [idea 2]

## Generated Posts
### [Date] - [Topic]
**Hook**: ...
**Post**: ...
**Performance notes**: ...

## Engagement Learnings
- What worked: ...
- What didn't: ...
```

## Post Formats

The plugin supports four high-performing post formats:

1. **Story-driven**: Personal experiences, lessons learned, case studies
2. **List/Framework**: Actionable insights, numbered tips, frameworks
3. **Hot take/Opinion**: Contrarian views, strong opinions
4. **News commentary**: Reactions to current AI news

## Posting Strategy

Optimized for **1-2 posts per week** (quality over quantity):

- **Primary Post**: Tuesday or Wednesday, 8-10 AM
- **Secondary Post** (optional): Thursday or Friday, 8-10 AM

## Agents

| Agent | Purpose | Trigger |
|-------|---------|---------|
| `content-optimizer` | Deep analysis and rewriting | "Really improve this post", "Transform my draft" |
| `trend-researcher` | Research current AI landscape | "What's happening in AI?", "Find trending topics" |

## Example Usage

```
> /generate-post AI adoption challenges in enterprise

> /optimize-post "Last week I learned something important about AI..."

> /research-trends

> /content-calendar AI governance theme

> /post-ideas

> /analyze-engagement impressions: 5000, reactions: 150, comments: 25
```

## Skills

The `linkedin-ai-strategy` skill provides:
- Hook writing patterns (50+ templates)
- Post format structures
- Engagement optimization tactics
- Topic angles for each focus area
- Example posts for each format

## License

MIT
