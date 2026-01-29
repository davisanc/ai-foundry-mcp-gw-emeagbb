# Quick Start: Enable Managed Identity for Your Webapp

## Problem
Your Azure AI Foundry resource has API key authentication disabled (`disableLocalAuth = true`). Your webapp fails to authenticate because it's trying to use `FOUNDRY_API_KEY`.

## Solution
Use **Azure Managed Identity** + **RBAC roles** instead of API keys.

---

## Quick Setup (5 minutes)

### 1️⃣ Enable Managed Identity on Web App

**Option A: One-liner (Recommended)**
```bash
export AZURE_SUBSCRIPTION_ID=<your-subscription-id>
export RESOURCE_GROUP=davidsr-AI-RG
export WEBAPP_NAME=mcp-server-app-davisanc
export AI_RESOURCE_NAME=davidsr-ai-project-resource

# Run the automated setup script
bash .github/scripts/setup_managed_identity.sh
```

**Option B: Manual Steps**

```bash
# Step 1: Enable managed identity on web app
az webapp identity assign \
  --resource-group davidsr-AI-RG \
  --name mcp-server-app-davisanc

# Save the Principal ID from the output (you'll need it next)
# Copy the "principalId" value
```

### 2️⃣ Grant Roles to Managed Identity

```bash
# Replace with your values
PRINCIPAL_ID="<principal-id-from-step-1>"
RESOURCE_GROUP="davidsr-AI-RG"
AI_RESOURCE_NAME="davidsr-ai-project-resource"

# Get the Foundry resource ID
RESOURCE_ID=$(az resource show \
  --name "$AI_RESOURCE_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --resource-type "Microsoft.CognitiveServices/accounts" \
  --query id \
  --output tsv)

# Grant roles
for ROLE in "Azure AI User" "Cognitive Services User" "Cognitive Services OpenAI Contributor"; do
  az role assignment create \
    --assignee "$PRINCIPAL_ID" \
    --role "$ROLE" \
    --scope "$RESOURCE_ID"
done

# Wait for propagation
sleep 120
```

### 3️⃣ Deploy Updated Code

The webapp code has been updated to support managed identity. Deploy it:

```bash
# Install dependencies
cd mcp-server
npm install

# Deploy to Azure
cd ..
git add .
git commit -m "Enable managed identity for Foundry access"
git push origin main

# Or manually deploy
az webapp up --resource-group davidsr-AI-RG --name mcp-server-app-davisanc
```

### 4️⃣ Verify It Works

```bash
# Check managed identity is enabled
az webapp identity show \
  --resource-group davidsr-AI-RG \
  --name mcp-server-app-davisanc

# Check role assignments
az role assignment list \
  --assignee "<principal-id-from-step-1>" \
  --scope /subscriptions/<subscription-id>/resourceGroups/davidsr-AI-RG
```

Then:
1. Go to `https://mcp-server-app-davisanc.azurewebsites.net`
2. Upload a test document
3. Try to query it
4. Check app logs - should show `Auth method: Managed Identity`

---

## What Changed in Your Code

Added support for managed identity authentication. The webapp now:

1. **If `FOUNDRY_API_KEY` is set**: Uses API key (backward compatible)
2. **If `FOUNDRY_API_KEY` is NOT set**: Automatically uses managed identity

**File**: `mcp-server/index.js` (around line 485)

```javascript
if (apiKey) {
  headers['api-key'] = apiKey;  // Use API key if available
  console.log("Auth method: API Key");
} else {
  // Use managed identity
  const credential = new DefaultAzureCredential();
  const token = await credential.getToken('https://cognitiveservices.azure.com/.default');
  headers['Authorization'] = `Bearer ${token.token}`;
  console.log("Auth method: Managed Identity");
}
```

**New dependency**: `@azure/identity` (already added to `package.json`)

---

## Troubleshooting

| Problem | Solution |
|---------|----------|
| "Access denied by RBAC" | Check role assignments: `az role assignment list --assignee <principal-id>` |
| "Managed identity not found" | Re-run: `az webapp identity assign` |
| "Failed to obtain token" | Make sure app is deployed to Azure (not local) |
| "Resource not found" | Verify resource name: `az resource list --resource-group davidsr-AI-RG` |

---

## More Details

See [MANAGED_IDENTITY_SETUP.md](MANAGED_IDENTITY_SETUP.md) for:
- Full architecture diagram
- Detailed troubleshooting
- Security benefits
- Azure CLI commands
- Azure Portal UI steps

---

## RBAC Roles Explained

| Role | Purpose | Required |
|------|---------|----------|
| **Azure AI User** | Use AI models (needed for `agents/write` action) | ✅ Yes |
| **Cognitive Services User** | Use cognitive services APIs | ⏭️ Optional |
| **Cognitive Services OpenAI Contributor** | Use OpenAI models specifically | ⏭️ Optional |

---

## Key Files

- **Setup Script**: `.github/scripts/setup_managed_identity.sh`
- **Setup Guide**: `MANAGED_IDENTITY_SETUP.md`
- **Updated Code**: `mcp-server/index.js` (Foundry API call section)
- **Dependencies**: `mcp-server/package.json` (added `@azure/identity`)

---

## Architecture

```
Web App (Managed Identity enabled)
    ↓
    ├─→ Check if FOUNDRY_API_KEY set
    │
    ├─ If YES: Use API key (old way)
    │
    └─ If NO: Get token from IMDS
        ↓
        Azure Instance Metadata Service
        ↓
        Azure AD
        ↓
        Access Token ✅
        ↓
        Foundry Resource (checks RBAC role)
        ↓
        Grants access to models
```

---

## Done! 🎉

Your webapp can now use Foundry models without API keys. The authentication is:
- ✅ Automatic
- ✅ Secure  
- ✅ Scoped to specific resources via RBAC
- ✅ Audit-logged through Azure AD
