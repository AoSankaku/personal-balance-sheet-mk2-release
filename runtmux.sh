#!/bin/bash

tmux new-session \; \
  send-keys 'claude-monitor' Enter \; \
  split-window -v \; \
  split-window -h \; \
  select-pane -t 1 \; \
  send-keys 'claude' Enter \; \
  select-pane -t 2 \; \
  send-keys '' Enter
```

This gives you:
```
claude-monitor
---------------------------------
claude        | sub terminal
