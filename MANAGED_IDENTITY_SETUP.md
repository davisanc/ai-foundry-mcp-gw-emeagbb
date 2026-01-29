# Azure Managed Identity Setup for Webapp (API Key Authentication Disabled)

## Overview

Your Azure AI Foundry resource has API key authentication disabled (`disableLocalAuth = true`). To enable your webapp to access Foundry models, you must use **managed identity + RBAC** instead of API keys.

## Architecture

```
┌─────────────────────────────────────────────┐
│  Azure App Service (Web App)                │
│  - System-assigned Managed Identity enabled │
└────────────────┬────────────────────────────┘
                 │
                 │ Token Request (MSI endpoint)
                 │ GET http://169.254.169.254/metadata/identity/oauth2/token
                 │
                 ▼
┌─────────────────────────────────────────────┐
│  Azure Instance Metadata Service (IMDS)     │
│  (Built-in to Azure)                        │
└────────────────┬────────────────────────────┘
                 │
                 │ Returns Access Token
                 │
                 ▼
┌─────────────────────────────────────────────┐
│  Azure AD (Entra ID)                        │
│  - Validates managed identity               │
│  - Issues access token                      │
└────────────────┬────────────────────────────┘
                 │
                 │ Returns Token
                 │
                 ▼
┌─────────────────────────────────────────────┐
│  Azure AI Foundry Resource                  │
│  - Checks RBAC role (Azure AI User)         │
│  - Grants access to Foundry APIs            │
└─────────────────────────────────────────────┘
```

## Step 1: Enable Managed Identity on Web App

### Via Azure Portal:
1. Go to **Azure Portal** → **App Services** → your web app (`mcp-server-app-davisanc`)
2. Click **Settings** → **Identity** (in left sidebar)
3. Under **System assigned** tab:
   - Toggle **Status** → **On**
   - Click **Save**
4. Wait for the identity to be created (you'll see an Object ID appear)

### Via Azure CLI:
```bash
az webapp identity assign \
  --resource-group davidsr-AI-RG \
  --name mcp-server-app-davisanc
```

This returns the managed identity details:
```json
{
  "principalId": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
  "tenantId": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
  "type": "SystemAssigned"
}
```

**Save the `principalId`** - you'll need it in the next step.

---

## Step 2: Grant RBAC Roles to Managed Identity

You need to assign the **Azure AI User** role (and optionally other roles) to your managed identity on the Foundry resource.

### Option A: Using Your grant_permissions.sh Script (Recommended)

Modify your existing `grant_permissions.sh` to use the managed identity's principal ID:

```bash
#!/bin/bash
# Grant permissions to Web App Managed Identity for Foundry access

# Set these values:
PRINCIPAL_ID="<MANAGED_IDENTITY_PRINCIPAL_ID>"  # From Step 1 output
AI_PROJECT_NAME="${AI_PROJECT_NAME:-davidsr-ai-project-resource}"
RESOURCE_GROUP="${RESOURCE_GROUP:-davidsr-AI-RG}"
SUBSCRIPTION_ID="${AZURE_SUBSCRIPTION_ID}"

echo "Granting RBAC roles to managed identity for Foundry access..."
echo "Principal ID: $PRINCIPAL_ID"
echo "Resource: $AI_PROJECT_NAME"

# Get the resource ID
RESOURCE_ID=$(az resource show \
  --name "$AI_PROJECT_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --resource-type "Microsoft.CognitiveServices/accounts" \
  --query id \
  --output tsv)

if [ -z "$RESOURCE_ID" ]; then
  echo "❌ Could not find resource $AI_PROJECT_NAME"
  exit 1
fi

echo "Resource ID: $RESOURCE_ID"

# Required roles for accessing Foundry models
ROLES=("Azure AI User" "Cognitive Services User" "Cognitive Services OpenAI Contributor")

for ROLE_NAME in "${ROLES[@]}"; do
  echo "Checking role: $ROLE_NAME"
  
  # Check if role already assigned
  EXISTING_ASSIGNMENT=$(az role assignment list \
    --assignee "$PRINCIPAL_ID" \
    --scope "$RESOURCE_ID" \
    --role "$ROLE_NAME" \
    --query "[0].id" \
    --output tsv 2>/dev/null)

  if [ -n "$EXISTING_ASSIGNMENT" ]; then
    echo "✅ Role '$ROLE_NAME' already assigned"
  else
    echo "Granting role: $ROLE_NAME"
    
    az role assignment create \
      --assignee "$PRINCIPAL_ID" \
      --role "$ROLE_NAME" \
      --scope "$RESOURCE_ID" \
      --output json 2>/dev/null
    
    if [ $? -eq 0 ]; then
      echo "✅ Successfully granted role: $ROLE_NAME"
    else
      echo "⚠️  Could not grant role at resource scope"
    fi
  fi
  echo ""
done

echo "✅ Role assignment complete!"
echo "Waiting 60 seconds for propagation..."
sleep 60
echo "✅ Managed identity can now access Foundry models"
```

### Option B: Via Azure Portal UI

1. Go to **Azure Portal** → **Foundry Resource** (your AI account)
2. Click **Access control (IAM)** in left sidebar
3. Click **+ Add** → **Add role assignment**
4. **Role**: Select `Azure AI User`
5. **Assign access to**: `Managed Identity`
6. **Members**: Click **Select members**, search for your web app name (`mcp-server-app-davisanc`), select it
7. Click **Review + assign**
8. Repeat for `Cognitive Services User` and `Cognitive Services OpenAI Contributor` (optional)

### Option C: Via Azure CLI

```bash
# Replace with your values
PRINCIPAL_ID="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"  # From Step 1
RESOURCE_GROUP="davidsr-AI-RG"
RESOURCE_NAME="davidsr-ai-project-resource"

# Get resource ID
RESOURCE_ID=$(az resource show \
  --name "$RESOURCE_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --resource-type "Microsoft.CognitiveServices/accounts" \
  --query id \
  --output tsv)

# Assign roles
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

echo "✅ All roles assigned to managed identity"
```

---

## Step 3: Update Web App Configuration

### Remove API Key (If Using Managed Identity)

If you want to completely disable API key authentication, remove the `FOUNDRY_API_KEY` environment variable:

1. Go to **Azure Portal** → **App Services** → your web app
2. Click **Settings** → **Configuration**
3. Find `FOUNDRY_API_KEY` in Application settings
4. Delete it or set it to empty
5. Click **Save**

**Note**: The updated code supports both API key and managed identity. If `FOUNDRY_API_KEY` is set, it will use that. Otherwise, it will use managed identity.

### Verify Configuration

Your app should have:
- ✅ `FOUNDRY_ENDPOINT` (e.g., `https://xxxxx.openai.azure.com/openai/deployments/gpt-4o-mini/chat/completions?api-version=2024-08-01-preview`)
- ⚠️ `FOUNDRY_API_KEY` (optional - can be empty or deleted if using managed identity)
- ✅ System-assigned Managed Identity enabled

---

## Step 4: Redeploy Your Web App

Deploy the updated code that supports managed identity:

```bash
# Navigate to your repo
cd c:\Users\dasanc\source\repos\ai-foundry-mcp-gw-emeagbb

# Install new dependencies
cd mcp-server
npm install

# Test locally (if you have Azure credentials configured)
npm start

# Deploy to Azure
# Via Git push (triggers GitHub Actions):
git add .
git commit -m "Enable managed identity for Foundry access"
git push origin main

# OR manually via Azure CLI:
az webapp up --resource-group davidsr-AI-RG --name mcp-server-app-davisanc
```

---

## Step 5: Verify It Works

### Check Managed Identity is Active

```bash
# Verify the web app has managed identity enabled
az webapp identity show \
  --resource-group davidsr-AI-RG \
  --name mcp-server-app-davisanc
```

Expected output:
```json
{
  "principalId": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
  "tenantId": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
  "type": "SystemAssigned"
}
```

### Check Role Assignments

```bash
az role assignment list \
  --assignee "<PRINCIPAL_ID_FROM_ABOVE>" \
  --scope /subscriptions/<SUBSCRIPTION_ID>/resourceGroups/davidsr-AI-RG
```

You should see `Azure AI User`, `Cognitive Services User`, and `Cognitive Services OpenAI Contributor` roles listed.

### Test the Webapp

1. Go to your web app: `https://mcp-server-app-davisanc.azurewebsites.net`
2. Upload a test document
3. Try to query it - the webapp should now use the managed identity to authenticate with Foundry
4. Check the web app logs for the authentication method being used:
   ```
   Auth method: Managed Identity
   ```

---

## Troubleshooting

### Error: "Access denied by RBAC"

**Cause**: Managed identity doesn't have required roles

**Solution**:
```bash
# Re-run role assignment
az role assignment create \
  --assignee "$PRINCIPAL_ID" \
  --role "Azure AI User" \
  --scope "$RESOURCE_ID"

# Wait 2-5 minutes for role propagation
sleep 120
```

### Error: "Managed identity not found"

**Cause**: Managed identity not enabled on web app

**Solution**:
```bash
az webapp identity assign \
  --resource-group davidsr-AI-RG \
  --name mcp-server-app-davisanc
```

### Error: "Failed to obtain token from IMDS"

**Cause**: Web app is not running in Azure or IMDS is unreachable

**Solution**:
- Make sure your app is deployed to Azure (not local)
- Check that the web app is running: `az webapp show --resource-group davidsr-AI-RG --name mcp-server-app-davisanc`
- Check app logs for IMDS connection errors

### Error: "Invalid resource for token request"

**Cause**: Token scope is incorrect

**Solution**: The code uses `https://cognitiveservices.azure.com/.default` scope, which is correct for Cognitive Services. Verify it's not being overridden.

---

## Security Benefits

✅ **No credentials in code or environment variables**  
✅ **Automatic token rotation**  
✅ **Audit trail through Azure AD**  
✅ **Fine-grained RBAC control**  
✅ **Compliant with Zero Trust security model**  

---

## Comparison: API Key vs Managed Identity

| Aspect | API Key | Managed Identity |
|--------|---------|------------------|
| Credentials | String in env var | Automatic from IMDS |
| Rotation | Manual | Automatic |
| Storage | Secret management | None needed |
| Audit Trail | Limited | Full Azure AD audit |
| Scope | Access entire account | RBAC controlled |
| Security | Keys can be leaked | Scoped to Azure resources |
| **Supported** | ❌ API keys disabled | ✅ Recommended |

---

## Code Implementation

The webapp code has been updated to support both methods:

```javascript
// If FOUNDRY_API_KEY is set, use it
if (apiKey) {
  headers['api-key'] = apiKey;
  console.log("Auth method: API Key");
} else {
  // Otherwise, use managed identity
  const credential = new DefaultAzureCredential();
  const token = await credential.getToken('https://cognitiveservices.azure.com/.default');
  headers['Authorization'] = `Bearer ${token.token}`;
  console.log("Auth method: Managed Identity");
}
```

This `DefaultAzureCredential` chain will:
1. Try environment variables (for local dev)
2. Try managed identity (when running in Azure)
3. Try other authentication methods as fallback

---

## Next Steps

1. ✅ Enable managed identity on web app (Step 1)
2. ✅ Grant RBAC roles to managed identity (Step 2)
3. ✅ Update web app config (Step 3)
4. ✅ Redeploy web app (Step 4)
5. ✅ Verify it works (Step 5)
6. ⏭️ Remove `FOUNDRY_API_KEY` from secrets (optional, for full security)
7. ⏭️ Update deployment pipeline to not use API keys

## References

- [Azure Managed Identity Documentation](https://learn.microsoft.com/en-us/azure/active-directory/managed-identities-azure-resources/overview)
- [Azure SDK JavaScript - DefaultAzureCredential](https://learn.microsoft.com/en-us/javascript/api/@azure/identity/defaultazurecredential)
- [Azure AI Foundry - Authentication Methods](https://learn.microsoft.com/en-us/azure/ai-foundry/how-to/authenticate)
- [RBAC Roles for Cognitive Services](https://learn.microsoft.com/en-us/azure/role-based-access-control/built-in-roles#cognitive-services)
