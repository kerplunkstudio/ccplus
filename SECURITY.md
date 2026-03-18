# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 1.0.x   | Yes |

## Reporting a Vulnerability

We take security vulnerabilities seriously. If you discover a security issue in ccplus, please report it responsibly.

### How to Report

**Preferred method**: Use [GitHub's private vulnerability reporting](https://github.com/kerplunkstudio/ccplus/security/advisories/new)

**Alternative**: Email [security@ccplus.run](mailto:security@ccplus.run)

### What to Include

- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if available)

### What to Expect

- **Acknowledgment**: Within 48 hours
- **Status update**: Within 7 days
- **Fix timeline**:
  - Critical vulnerabilities: 30 days
  - High severity: 60 days
  - Medium/Low severity: 90 days

We will keep you informed throughout the process and credit you in the fix (unless you prefer to remain anonymous).

### Disclosure Policy

**Do not disclose publicly** until:
- A fix has been released
- We have published a security advisory
- 90 days have passed since your report (whichever comes first)

Public disclosure before a fix is available puts all users at risk.

## Security Best Practices

When using ccplus:
- Keep your installation updated
- Protect your `.env` file (contains sensitive API keys)
- Use strong JWT secrets in production deployments
- Review database permissions if hosting remotely
- Enable HTTPS when exposing the web UI outside localhost

## Out of Scope

The following are not considered security vulnerabilities:
- Denial of service from malformed Claude Code SDK responses
- Issues in dependencies already reported upstream
- Social engineering attacks
- Physical access attacks
