# Signing the Windows build

Releases are signed for the updater (an ed25519 key, `TAURI_SIGNING_PRIVATE_KEY`), but the installers themselves are not Authenticode-signed, so SmartScreen warns on first launch. The release workflow is ready to sign them through **Azure Artifact Signing** (previously called Trusted Signing). That costs a monthly fee instead of a yearly certificate, and the key never leaves Azure. Signing stays off until the settings below exist.

## One-time setup in Azure

1. Create an Azure account and a subscription.
2. Create an **Artifact Signing account**. Pick the region closest to you and note its endpoint, e.g. `https://weu.codesigning.azure.net`.
3. Complete **identity validation** for an individual or an organisation. Microsoft checks a government ID, which takes a few days.
4. Create a **certificate profile** of type *Public Trust*.
5. Register an app in Microsoft Entra ID (App registrations → New), then create a client secret for it.
6. On the signing account, give that app the **Artifact Signing Certificate Profile Signer** role.

## Wiring it into GitHub

In the repository's *Settings → Secrets and variables → Actions*:

| kind | name | value |
|---|---|---|
| variable | `AZURE_SIGNING_ENDPOINT` | the account endpoint, e.g. `https://weu.codesigning.azure.net` |
| variable | `AZURE_SIGNING_ACCOUNT` | the signing account name |
| variable | `AZURE_SIGNING_PROFILE` | the certificate profile name |
| secret | `AZURE_CLIENT_ID` | the app registration's client ID |
| secret | `AZURE_CLIENT_SECRET` | its client secret |
| secret | `AZURE_TENANT_ID` | the Entra tenant ID |

Once `AZURE_SIGNING_ACCOUNT` is set, the Windows job installs `trusted-signing-cli` and passes Tauri a `signCommand`. Tauri then signs the app executable, both installers and the updater bundle. Run the workflow by hand on a branch first (`gh workflow run release.yml --ref <branch>`). Then check a downloaded installer under *Properties → Digital Signatures*.

SmartScreen builds reputation per certificate, so the first few signed releases may still show a warning for a short while.
