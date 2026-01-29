# Managed Identity Migration - Changes Summary

## Overview
✅ **Migration Complete**: All code has been updated to use Azure Managed Identity instead of API key authentication.

## Files Changed

### 1. **NEW FILE: `mcp-server/auth.js`** ✅
- **Purpose**: Centralized authentication module for all Azure API calls
- **Key Features**:
  - `getAuthHeaders()` - Returns authentication headers (API key OR managed identity token)
  - `makeAuthenticatedRequest()` - Helper for making authenticated HTTP requests
  - Automatic fallback: Uses API key if `FOUNDRY_API_KEY` is set, otherwise managed identity
  - Comprehensive logging for debugging

**Code Example**:
```javascript
const { getAuthHeaders } = require('./auth');

// Usage in any endpoint that needs auth
const authHeaders = await getAuthHeaders();
const headers = {
  'Content-Type': 'application/json',
  ...authHeaders  // Includes either 'api-key' or 'Authorization'
};
```

### 2. **MODIFIED: `mcp-server/index.js`** ✅

#### Added:
- **Import**: `const { getAuthHeaders, makeAuthenticatedRequest } = require('./auth');`
- **Comments**: Comprehensive documentation explaining the migration (lines 1-45)

#### Changed (Query Endpoint `/session/:sid/query`):
**Before**:
```javascript
const apiKey = process.env.FOUNDRY_API_KEY;
const useApiKey = !!apiKey;

let headers = { 'Content-Type': 'application/json' };

if (useApiKey) {
  headers['api-key'] = apiKey;
} else {
  const credential = new DefaultAzureCredential();
  const token = await credential.getToken('https://cognitiveservices.azure.com/.default');
  headers['Authorization'] = `Bearer ${token.token}`;
}
```

**After**:
```javascript
const authHeaders = await getAuthHeaders();

const headers = {
  'Content-Type': 'application/json',
  ...authHeaders
};
```

**Benefits**:
- ✅ Cleaner, more maintainable code
- ✅ Centralized auth logic (easier to update in future)
- ✅ Same functionality with better separation of concerns

### 3. **NEW FILE: `MANAGED_IDENTITY_MIGRATION.md`** ✅
Comprehensive guide including:
- Architecture diagram
- Step-by-step setup instructions
- Role assignment scripts
- Verification procedures
- Troubleshooting guide
- Benefits comparison table

### 4. **MODIFIED: `README.md`** ✅
**Added**:
- ⚠️ Warning banner at top highlighting managed identity requirement
- Updated secrets table marking `FOUNDRY_API_KEY` as **optional** (not required)
- Note explaining that web app uses managed identity for auth

### 5. **MODIFIED: `.github/workflows/deploy.yml`** ✅

#### Added Steps:
1. **Enable Managed Identity on Web App**
   ```yaml
   - name: Enable Managed Identity on Web App
     run: |
       az webapp identity assign \
         -g $AZURE_RESOURCE_GROUP \
         -n $WEBAPP_NAME
   ```

2. **Grant Web App Access to AI Foundry**
   ```yaml
   - name: Grant Web App Access to AI Foundry (Managed Identity)
     run: |
       # Gets managed identity principal ID
       # Assigns RBAC roles to managed identity:
       # - Azure AI User
       # - Cognitive Services User
       # - Cognitive Services OpenAI Contributor
   ```

#### Removed:
- ❌ `FOUNDRY_API_KEY=${{ secrets.FOUNDRY_API_KEY }}` from app settings

### 6. **EXISTING: `mcp-server/package.json`** ✅
- ✅ Already contains `@azure/identity: ^4.0.0` (verified)
- No changes needed

## Migration Flow

```
GitHub Actions Push
        ↓
Azure Login (Service Principal)
        ↓
Create Web App
        ↓
✅ Enable Managed Identity (NEW)
        ↓
Set App Settings (FOUNDRY_ENDPOINT only, no API key)
        ↓
✅ Grant Managed Identity Roles (NEW)
        ↓
Deploy Code (uses auth.js for secure auth)
        ↓
Web App Ready (uses managed identity automatically)
```

## Authentication Flow at Runtime

```
Request to AI Foundry API
        ↓
index.js calls getAuthHeaders()
        ↓
auth.js checks if FOUNDRY_API_KEY env var exists
        ↓
   YES → Return {'api-key': value}
   NO → Call DefaultAzureCredential.getToken()
        ↓
   In Azure: Uses web app's managed identity automatically
   Local: Uses local Azure CLI credentials (az login)
        ↓
Return authentication headers
        ↓
Include in request to AI Foundry
        ↓
Azure validates using managed identity's RBAC roles
        ↓
Request succeeds (if proper roles assigned)
```

## Security Improvements

| Aspect | Before (API Key) | After (Managed Identity) |
|--------|------------------|--------------------------|
| **Credentials** | Stored in env var | None - built into Azure |
| **Rotation** | Manual | Automatic (1 hour) |
| **Scope** | Global (risky) | Resource-specific (RBAC) |
| **Audit** | Limited | Full Azure AD audit trail |
| **Local Testing** | Works immediately | Requires `az login` |
| **Production** | ⚠️ API keys disabled | ✅ Recommended |

## Next Steps

1. **Commit Changes**:
   ```bash
   git add .
   git commit -m "migrate to managed identity authentication"
   git push origin main
   ```

2. **GitHub Actions Will**:
   - Enable managed identity on web app
   - Grant required RBAC roles
   - Deploy updated code
   - Set only `FOUNDRY_ENDPOINT` in app settings

3. **Verify Deployment**:
   - Check App Service logs for: `✅ Using Managed Identity authentication`
   - Test API endpoints to ensure they work

4. **Optional: Remove API Key Secret**
   - If you no longer need the API key, remove from GitHub Secrets
   - (Code will still work if it exists but isn't used)

## Testing Locally

If you want to test the auth module locally:

```bash
# Setup local Azure credentials
az login
az account set --subscription <subscription-id>

# Test auth module
cd mcp-server
node -e "const auth = require('./auth'); auth.getAuthHeaders().then(h => console.log(h))"
```

## Documentation Files

- **[MANAGED_IDENTITY_MIGRATION.md](./MANAGED_IDENTITY_MIGRATION.md)** - Complete setup guide
- **[QUICK_START_MANAGED_IDENTITY.md](./QUICK_START_MANAGED_IDENTITY.md)** - Quick reference
- **[README.md](./README.md)** - Updated with managed identity info
- **[MANAGED_IDENTITY_SETUP.md](./MANAGED_IDENTITY_SETUP.md)** - Original setup reference

## Questions?

Refer to [MANAGED_IDENTITY_MIGRATION.md](./MANAGED_IDENTITY_MIGRATION.md) for:
- Troubleshooting guide
- Architecture diagrams
- Azure RBAC role reference
- Error solutions
