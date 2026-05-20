## Summary

- What changed:
- Why it changed:

## Backup Risk Review

- [ ] No backup creation, retention, restore, encryption, or storage behavior changed.
- [ ] If backup behavior changed, restore impact is explained below.
- [ ] If retention behavior changed, deletion risk is explained below.
- [ ] If encryption behavior changed, key handling and recovery impact are explained below.
- [ ] If storage provider behavior changed, bucket/path/credential impact is explained below.

## Operational Evidence

- [ ] `pnpm verify` passed locally.
- [ ] New or changed harness rules have clear failure messages.
- [ ] No production secrets or real credentials are included.
- [ ] Docs or exec plans were updated when behavior changed.

## Restore And Rollback Notes

Describe how to verify restore safety, roll back the change, or recover from a failed run:

-

## Deployment Notes

Mention required env/config changes, schedule changes, or migration steps:

-
