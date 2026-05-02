# Shadowbrain × groundtruth

groundtruth gates honesty (the Stop hook blocks unverified completion claims). Shadowbrain captures what the honest answer was so the next agent doesn't have to re-derive it. They compose at session boundaries.

## Setup

Both tools installed:

```bash
npm install -g shadowbrain
curl -fsSL https://raw.githubusercontent.com/vnmoorthy/groundtruth/main/install.sh | bash
claude mcp add shadowbrain -- shadowbrain serve
shadowbrain trust set $(git config --get remote.origin.url) --tier read-write
groundtruth status   # should report "stop hook: registered"
```

## Pattern — Stop hook nudges memory_put

Add this to `~/.claude/settings.json` `hooks.Stop`:

```json
{
  "hooks": {
    "Stop": [
      {
        "matcher": "made_changes:true && memory_put_called:false",
        "hooks": [
          {
            "type": "command",
            "command": "echo 'reminder: this session made changes but did not call memory_put. consider capturing a learning before you stop.'"
          }
        ]
      }
    ]
  }
}
```

(The `matcher` syntax above is illustrative; check your `groundtruth` version for exact field names.)

This is opt-in by design. Agents that find the nudge counterproductive can omit it.

## Why this composes

- **groundtruth keeps the agent honest mid-session.** Don't claim "tests pass" without running them.
- **shadowbrain keeps the next session smarter.** Don't make the next agent rediscover what this session figured out.

Without groundtruth, agents can claim victory without evidence — and write memories that turn out to be wrong. Without shadowbrain, every honest session pays the same context tax.

## Avoiding overlap

groundtruth's `audit` command scans past sessions for unverified claims. shadowbrain's `memory_audit` lists entries with provenance + warnings. They look at different artifacts (session transcripts vs. stored memories) so they're complementary, not redundant.

## Honest caveat

The Stop-hook nudge can produce false positives: a session that made changes but where no memory was warranted (the change was trivial). The reminder has to be soft enough not to be annoying. Tune the matcher.
