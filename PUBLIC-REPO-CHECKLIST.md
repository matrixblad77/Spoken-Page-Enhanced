# Public Repository Safety Checklist

Before the first push, verify that the repository contains no:

- `.env` files with real secrets
- Audiobookshelf tokens/cookies
- personal usernames
- personal drive letters and library paths
- private IP addresses or LAN URLs
- log files from a real installation
- screenshots exposing personal media metadata
- downloaded audiobook files
- private Docker volume contents
- browser session data

Use generic examples such as:

```text
C:\Users\USERNAME\...
F:\AudioBooks\...
http://HOST:13378
```

Do not use real machine paths in documentation.
