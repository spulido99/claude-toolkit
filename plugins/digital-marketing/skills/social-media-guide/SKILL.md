# Social Media Guide

This skill should be used when users want to post to social media platforms, understand platform-specific workflows, or need guidance on publishing content via Chrome browser automation. Trigger phrases include: "post to instagram", "facebook post", "linkedin post", "twitter post", "tiktok post", "schedule post", "publish content".

## Chrome Browser Automation Workflows

All posting actions use the Claude Chrome extension. The user must be logged into their social media accounts in Chrome.

### General Workflow Pattern
1. Open platform via `mcp__claude-in-chrome__navigate`
2. Wait for page to load
3. Find post creation element using `mcp__claude-in-chrome__find` or `mcp__claude-in-chrome__read_page`
4. Click to open composer using `mcp__claude-in-chrome__computer`
5. Enter text using `mcp__claude-in-chrome__form_input` or `mcp__claude-in-chrome__computer` (type action)
6. Prompt user to manually add images/videos (cannot automate file uploads from disk)
7. Confirm with user before clicking Post/Publish
8. Take screenshot for records

## Platform-Specific Posting

### Instagram (Web)
**URL**: https://www.instagram.com

**Workflow**:
1. Navigate to instagram.com
2. Click the "+" (Create) button in the navigation
3. Select "Post" from dropdown
4. User must manually select image/video
5. Click "Next" to proceed to caption
6. Enter caption text
7. Add location if desired
8. Confirm before clicking "Share"

**Limitations**:
- Cannot upload images directly via automation
- Stories must be done via mobile
- Reels have complex editing that requires manual work

### Facebook (Web)
**URL**: https://www.facebook.com

**Workflow**:
1. Navigate to facebook.com
2. Find "What's on your mind?" composer box
3. Click to expand
4. Enter post text
5. User adds media if needed
6. Select audience (Public, Friends, etc.)
7. Confirm before clicking "Post"

**For Pages**:
1. Navigate to facebook.com/[page-name]
2. Click "Create post" button
3. Follow same flow

### LinkedIn (Web)
**URL**: https://www.linkedin.com

**Workflow**:
1. Navigate to linkedin.com/feed
2. Click "Start a post" button
3. Enter post text in composer
4. User adds media if needed
5. Confirm before clicking "Post"

**For Company Pages**:
1. Navigate to linkedin.com/company/[company-name]
2. Click "Start a post"
3. Follow same flow

### Twitter/X (Web)
**URL**: https://twitter.com or https://x.com

**Workflow**:
1. Navigate to twitter.com/home
2. Find "What is happening?!" composer
3. Click to focus
4. Enter tweet text (max 280 chars)
5. User adds media if needed
6. Confirm before clicking "Post"

**For Threads**:
1. Type first tweet
2. Click "+" to add more tweets
3. Complete thread
4. Confirm before posting all

### TikTok (Web)
**URL**: https://www.tiktok.com/upload

**Workflow**:
1. Navigate to tiktok.com/upload
2. User must manually upload video
3. Enter caption text
4. Add hashtags
5. Configure settings (comments, duet, stitch)
6. Confirm before clicking "Post"

**Note**: TikTok web has limited features compared to mobile app

## Best Posting Times

### General Guidelines (User's Local Time)

| Platform | Best Days | Best Times |
|----------|-----------|------------|
| Instagram | Tue-Fri | 11am-1pm, 7-9pm |
| Facebook | Wed-Fri | 1-4pm |
| LinkedIn | Tue-Thu | 7-8am, 12pm, 5-6pm |
| Twitter | Tue-Wed | 9am-12pm |
| TikTok | Tue-Thu | 7-9pm |

### By Audience Type

**B2B Audiences**:
- Best: Tuesday-Thursday, business hours
- Avoid: Weekends, Monday mornings, Friday afternoons

**B2C Audiences**:
- Best: Evenings (7-9pm), weekends
- Platform-specific variations apply

**Latin America Considerations**:
- Adjust for time zones (GMT-3 to GMT-8)
- Lunch hours (1-3pm) often have high engagement
- Late evenings (9-11pm) work well

## Image and Video Requirements

### Image Sizes

| Platform | Feed Post | Story | Profile |
|----------|-----------|-------|---------|
| Instagram | 1080x1080, 1080x1350 | 1080x1920 | 320x320 |
| Facebook | 1200x630, 1200x1200 | 1080x1920 | 170x170 |
| LinkedIn | 1200x627, 1080x1080 | N/A | 400x400 |
| Twitter | 1200x675, 1200x1200 | N/A | 400x400 |
| TikTok | N/A | 1080x1920 | 200x200 |

### Video Specifications

| Platform | Max Length | Optimal Length | Aspect Ratio |
|----------|------------|----------------|--------------|
| Instagram Reels | 90 sec | 15-30 sec | 9:16 |
| Instagram Feed | 60 min | 30-60 sec | 1:1, 4:5 |
| Facebook | 240 min | 1-3 min | 16:9, 1:1 |
| LinkedIn | 10 min | 30-90 sec | 1:1, 16:9 |
| Twitter | 2:20 min | 15-45 sec | 16:9, 1:1 |
| TikTok | 10 min | 21-34 sec | 9:16 |

## Engagement Best Practices

### Post-Publishing Checklist
1. Respond to comments within first hour
2. Engage with similar content in your niche
3. Share to Stories (Instagram, Facebook)
4. Cross-post to other platforms if appropriate

### Community Management
- Reply to all comments within 24 hours
- Use questions to encourage more engagement
- Pin best comments to top
- Address negative comments professionally

## Error Handling

### Common Issues

**"Unable to post"**:
- Check if logged into correct account
- Verify no content policy violations
- Try refreshing the page
- Check for platform outages

**"Character limit exceeded"**:
- Shorten content to fit platform limits
- Move extra content to comments

**"Image upload failed"**:
- Verify image meets size requirements
- Try different file format (JPG, PNG)
- Reduce file size if too large

**"Account restricted"**:
- Check platform notifications for violations
- Wait if temporary restriction
- Contact platform support if needed
