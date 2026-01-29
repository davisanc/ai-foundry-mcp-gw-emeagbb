# Managed Identity Migration Guide

## Overview

Azure AI Foundry has **disabled API key authentication** (`disableLocalAuth = true`). This document guides you through migrating from API key-based authentication to **Azure Managed Identity**.

> **Status**: ✅ Code updated to support managed identity as primary auth method

## What Changed

### Before (API Key - ❌ NO LONGER SUPPORTED)
```javascript
// Old way - API Key in environment variable
headers['api-key'] = process.env.FOUNDRY_API_KEY;
```

### After (Managed Identity - ✅ RECOMMENDED)
```javascript
// New way - Automatic token from Azure infrastructure
const credential = new DefaultAzureCredential();
const token = await credential.getToken('https://cognitiveservices.azure.com/.default');
headers['Authorization'] = `Bearer ${token.token}`;
```

## Architecture

```
┌─────────────────────────────────────────────────┐
│  Azure App Service (Web App)                    │
│  - Managed Identity: System-assigned enabled    │
└────────────────┬────────────────────────────────┘
                 │
                 │ Automatic token request
                 │ (no credentials needed)
                 ↓
┌─────────────────────────────────────────────────┐
│  Azure Instance Metadata Service (IMDS)         │
│  - Built-in to all Azure compute               │
│  - Endpoint: 169.254.169.254/metadata/identity  │
└────────────────┬────────────────────────────────┘
                 │
                 │ Validates identity & issues token
                 ↓
┌─────────────────────────────────────────────────┐
│  Azure AD (Entra ID)                            │
└────────────────┬────────────────────────────────┘
                 │
                 │ Returns access token
                 ↓
┌─────────────────────────────────────────────────┐
│  Azure AI Foundry                               │
│  - Checks RBAC role: "Azure AI User"           │
│  - Allows request if authorized                │
└─────────────────────────────────────────────────┘
```

## Implementation

### Step 1: New Auth Module

A new `mcp-server/auth.js` has been created with:
- ✅ `getAuthHeaders()` - Returns authentication headers
- ✅ `makeAuthenticatedRequest()` - Makes authenticated HTTP requests
- ✅ Automatic fallback to managed identity if no API key

**Key features:**
```javascript
// Get auth headers (uses API key if set, otherwise managed identity)
const authHeaders = await getAuthHeaders();

// Both work transparently:
headers = { ...authHeaders }; // Includes either 'api-key' or 'Authorization'

// Or use helper directly
const response = await makeAuthenticatedRequest(endpoint, {
  method: 'POST',
  body: JSON.stringify(payload)
});
```

### Step 2: Updated MCP Server

File: `mcp-server/index.js`

**Changed from:**
```javascript
const { DefaultAzureCredential } = require('@azure/identity');

// Inline auth logic
if (useApiKey) {
  headers['api-key'] = apiKey;
} else {
  const credential = new DefaultAzureCredential();
  const token = await credential.getToken('https://cognitiveservices.azure.com/.default');
  headers['Authorization'] = `Bearer ${token.token}`;
}
```

**Changed to:**
```javascript
const { getAuthHeaders } = require('./auth');

// Clean, centralized auth
const authHeaders = await getAuthHeaders();
const headers = {
  'Content-Type': 'application/json',
  ...authHeaders
};
```

## Setup Instructions

### Prerequisites

- ✅ Web app deployed to Azure App Service
- ✅ AI Foundry resource with `disableLocalAuth = true`
- ✅ Azure CLI installed locally

### 1. Enable Managed Identity on Web App

```bash
# Via Azure CLI
az webapp identity assign \
  --resource-group davidsr-AI-RG \
  --name mcp-server-app-davisanc

# Output will include:
# {
#   "principalId": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
#   "tenantId": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
#   "type": "SystemAssigned"
# }

# Save the principalId - you'll need it next
export PRINCIPAL_ID="<principal-id-from-above>"
```

### 2. Grant RBAC Roles to Managed Identity

```bash
export PRINCIPAL_ID="<principal-id-from-step-1>"
export RESOURCE_GROUP="davidsr-AI-RG"
export AI_RESOURCE_NAME="davidsr-ai-project-resource"

# Get the Foundry resource ID
RESOURCE_ID=$(az resource show \
  --name "$AI_RESOURCE_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --resource-type "Microsoft.CognitiveServices/accounts" \
  --query id \
  --output tsv)

echo "Resource ID: $RESOURCE_ID"

# Grant required roles
az role assignment create \
  --assignee "$PRINCIPAL_ID" \
  --role "Azure AI User" \
  --scope "$RESOURCE_ID"

az role assignment create \
  --assignee "$PRINCIPAL_ID" \
  --role "Cognitive Services User" \
  --scope "$RESOURCE_ID"

az role assignment create \
  --assignee "$PRINCIPAL_ID" \
  --role "Cognitive Services OpenAI Contributor" \
  --scope "$RESOURCE_ID"

echo "✅ Roles assigned. Waiting for propagation (120 seconds)..."
sleep 120
echo "✅ Ready to use managed identity!"
```

### 3. Remove API Key from Environment (Optional but Recommended)

For maximum security, remove the `FOUNDRY_API_KEY` environment variable:

**Via Azure Portal:**
1. Go to your App Service
2. Click **Settings** → **Configuration**
3. Find `FOUNDRY_API_KEY`
4. Delete it
5. Click **Save**

**Via Azure CLI:**
```bash
az webapp config appsettings delete \
  --resource-group davidsr-AI-RG \
  --name mcp-server-app-davisanc \
  --setting-names FOUNDRY_API_KEY
```

**Via GitHub Actions:**
If `FOUNDRY_API_KEY` is still in GitHub Secrets, you can:
1. Remove it from repository secrets (optional)
2. Or leave it but don't set it in the web app

### 4. Redeploy the Updated Code

```bash
# Push changes to main branch
git add mcp-server/auth.js mcp-server/index.js
git commit -m "migrate to managed identity authentication"
git push origin main

# GitHub Actions will automatically:
# 1. Deploy new code to App Service
# 2. Use managed identity for all Foundry API calls
```

## Verification

### Check That Managed Identity is Enabled

```bash
az webapp identity show \
  --resource-group davidsr-AI-RG \
  --name mcp-server-app-davisanc
```

**Expected output:**
```json
{
  "principalId": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
  "tenantId": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
  "type": "SystemAssigned"
}
```

### Check Role Assignments

```bash
# List all role assignments for the managed identity
PRINCIPAL_ID="<your-principal-id>"
RESOURCE_ID="/subscriptions/.../resourceGroups/.../providers/Microsoft.CognitiveServices/accounts/..."

az role assignment list \
  --assignee "$PRINCIPAL_ID" \
  --scope "$RESOURCE_ID"
```

### Check App Service Logs

1. Go to **App Service** → **Log Stream**
2. Look for log messages:
   - ✅ `✅ Using Managed Identity authentication` - Means it's working
   - ❌ `❌ Failed to obtain authentication token` - Check role assignments

### Test the Endpoint

```bash
# Test document analysis endpoint
curl -X POST https://mcp-server-app-davisanc.azurewebsites.net/api/analyze \
  -H "Content-Type: application/json" \
  -d '{
    "sessionId": "test-session",
    "docId": "test-doc",
    "query": "What is this document about?",
    "mode": "qa"
  }'
```

## Troubleshooting

### Error: "Failed to obtain token from IMDS"

**Cause:** The code is running outside of Azure or managed identity is not enabled

**Solution:**
- ✅ Ensure web app is deployed to Azure App Service
- ✅ Ensure managed identity is enabled (Step 1)
- ✅ Ensure roles are assigned (Step 2)

### Error: "InvalidAuthenticationTokenTenant"

**Cause:** The managed identity doesn't have the right roles

**Solution:**
- Run Step 2 again to verify roles are assigned
- Check resource scope - roles must be on the Foundry resource itself
- Wait 2-3 minutes for role assignments to propagate

### Error: "Insufficient privileges"

**Cause:** The Azure AI User role doesn't include the required data action

**Solution:**
- Ensure you have the correct roles:
  - ✅ `Azure AI User` - Primary role with data actions
  - ✅ `Cognitive Services User` - For service access
  - ✅ `Cognitive Services OpenAI Contributor` - For model usage

### Code Falls Back to API Key

**If `FOUNDRY_API_KEY` is set**, the code will use it instead of managed identity.

**Solution:**
```bash
# Check if API key is set
env | grep FOUNDRY_API_KEY

# Remove it from App Service configuration
az webapp config appsettings delete \
  --resource-group davidsr-AI-RG \
  --name mcp-server-app-davisanc \
  --setting-names FOUNDRY_API_KEY
```

## Benefits of Managed Identity

| Aspect | API Key | Managed Identity |
|--------|---------|------------------|
| **Credentials** | String in config | None needed |
| **Storage** | Env var (leakable) | None (built-in to Azure) |
| **Rotation** | Manual | Automatic by Azure |
| **Scope** | Global (risky) | Resource-specific via RBAC |
| **Local testing** | Works | Requires Azure credentials |
| **Production** | ⚠️ Weak (disabled now) | ✅ Recommended |

## Reference

- [Azure Managed Identity](https://learn.microsoft.com/en-us/entra/identity/managed-identities-azure-resources/overview)
- [DefaultAzureCredential](https://learn.microsoft.com/en-us/javascript/api/@azure/identity/defaultazurecredential)
- [Azure AI Foundry Authentication](https://learn.microsoft.com/en-us/azure/ai-foundry/how-to/authenticate)
- [Azure RBAC for Cognitive Services](https://learn.microsoft.com/en-us/azure/role-based-access-control/built-in-roles#cognitive-services-user)
