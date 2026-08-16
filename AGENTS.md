# Project Instructions

## Packaging

- macOS builds must not be code signed or notarized.
- Keep `build.mac.identity` set to `null` and keep `CSC_IDENTITY_AUTO_DISCOVERY=false` in the packaging flow.
- Do not add a signing identity, provisioning profile, notarization credentials, or certificate-related CI secrets unless the project owner explicitly requests signed distribution.
