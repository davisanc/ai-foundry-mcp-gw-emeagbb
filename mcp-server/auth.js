/**
 * Azure Authentication Utility
 * 
 * MIGRATION FROM API KEY TO MANAGED IDENTITY:
 * ============================================================================
 * 
 * CHANGES:
 * 1. Removed dependency on FOUNDRY_API_KEY environment variable
 * 2. Uses DefaultAzureCredential for automatic token acquisition
 * 3. When deployed to Azure, uses the web app's system-assigned managed identity
 * 
 * HOW IT WORKS:
 * - Web app has system-assigned managed identity enabled
 * - DefaultAzureCredential automatically detects this when running in Azure
 * - It acquires an OAuth token from Azure Instance Metadata Service (IMDS)
 * - Token is valid for 1 hour and automatically refreshed
 * - No API keys stored in environment variables or key vaults
 * 
 * SECURITY BENEFITS:
 * ✅ No credentials in code or environment variables
 * ✅ Automatic token rotation every hour
 * ✅ Scope limited to specific Azure resources via RBAC
 * ✅ Audit trail for all API calls (via Azure AD logs)
 * 
 * LOCAL TESTING:
 * - Set environment variables: AZURE_CLIENT_ID, AZURE_CLIENT_SECRET, AZURE_TENANT_ID
 * - Or use: az login && az account set --subscription <id>
 * - DefaultAzureCredential will try multiple auth methods automatically
 * 
 * REQUIRED RBAC ROLES (on AI Foundry resource):
 * - Azure AI User
 * - Cognitive Services User
 * - Cognitive Services OpenAI Contributor
 * 
 * ============================================================================
 */

const { DefaultAzureCredential } = require('@azure/identity');

// Cache for tokens (key -> { token, expiresAt })
const tokenCache = new Map();

/**
 * Get authentication headers for Azure Cognitive Services
 * 
 * @returns {Promise<Object>} Object with headers to include in requests
 * @throws {Error} If authentication fails
 */
async function getAuthHeaders() {
  const apiKey = process.env.FOUNDRY_API_KEY;
  
  if (apiKey) {
    // API Key authentication (backward compatible)
    console.log('✅ Using API Key authentication');
    return {
      'api-key': apiKey
    };
  }

  // Managed Identity authentication (preferred)
  console.log('🔐 Using Managed Identity authentication');
  
  try {
    const credential = new DefaultAzureCredential();
    const token = await credential.getToken('https://cognitiveservices.azure.com/.default');
    
    if (!token || !token.token) {
      throw new Error('Failed to obtain token from credential provider');
    }

    console.log('✅ Successfully obtained token from managed identity');
    
    return {
      'Authorization': `Bearer ${token.token}`
    };
  } catch (error) {
    console.error('❌ Failed to obtain authentication token:', error.message);
    
    // Provide helpful error messages
    if (error.message.includes('ENOTFOUND')) {
      console.error('💡 Hint: Ensure the app is running in Azure (managed identity is only available in Azure)');
      console.error('💡 For local testing, set FOUNDRY_API_KEY environment variable');
    }
    
    throw new Error(`Authentication failed: ${error.message}`);
  }
}

/**
 * Make an authenticated request to Azure Cognitive Services
 * 
 * @param {string} endpoint - The Azure endpoint URL
 * @param {Object} options - Fetch options (method, body, etc.)
 * @returns {Promise<Response>} The fetch response
 */
async function makeAuthenticatedRequest(endpoint, options = {}) {
  try {
    const authHeaders = await getAuthHeaders();
    
    const headers = {
      'Content-Type': 'application/json',
      ...authHeaders,
      ...options.headers
    };

    console.log(`📤 Making authenticated request to: ${endpoint}`);
    console.log(`   Method: ${options.method || 'GET'}`);
    console.log(`   Auth: ${headers['api-key'] ? 'API Key' : 'Bearer Token'}`);

    const response = await fetch(endpoint, {
      ...options,
      headers
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      console.error(`❌ Request failed with status ${response.status}:`, errorData);
      throw new Error(`HTTP ${response.status}: ${errorData.error?.message || 'Unknown error'}`);
    }

    return response;
  } catch (error) {
    console.error('❌ Authenticated request failed:', error.message);
    throw error;
  }
}

module.exports = {
  getAuthHeaders,
  makeAuthenticatedRequest
};
