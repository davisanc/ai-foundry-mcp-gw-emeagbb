#!/bin/bash
# Quick setup script for managed identity on web app
# This script handles Steps 1-2 from MANAGED_IDENTITY_SETUP.md

set -e

echo "========================================="
echo "Azure Managed Identity Setup for Web App"
echo "========================================="
echo ""

# Configuration
RESOURCE_GROUP="${RESOURCE_GROUP:-davidsr-AI-RG}"
WEBAPP_NAME="${WEBAPP_NAME:-mcp-server-app-davisanc}"
AI_RESOURCE_NAME="${AI_RESOURCE_NAME:-davidsr-ai-project-resource}"
SUBSCRIPTION_ID="${AZURE_SUBSCRIPTION_ID}"

if [ -z "$SUBSCRIPTION_ID" ]; then
  echo "Error: AZURE_SUBSCRIPTION_ID not set"
  echo "Run: export AZURE_SUBSCRIPTION_ID=<your-subscription-id>"
  exit 1
fi

echo "Configuration:"
echo "  Resource Group: $RESOURCE_GROUP"
echo "  Web App: $WEBAPP_NAME"
echo "  AI Resource: $AI_RESOURCE_NAME"
echo "  Subscription: $SUBSCRIPTION_ID"
echo ""

# Step 1: Enable Managed Identity
echo "========================================="
echo "Step 1: Enabling Managed Identity..."
echo "========================================="
echo ""

IDENTITY_RESPONSE=$(az webapp identity assign \
  --resource-group "$RESOURCE_GROUP" \
  --name "$WEBAPP_NAME" \
  --output json)

PRINCIPAL_ID=$(echo "$IDENTITY_RESPONSE" | jq -r '.principalId')

if [ -z "$PRINCIPAL_ID" ] || [ "$PRINCIPAL_ID" = "null" ]; then
  echo "❌ Failed to enable managed identity"
  exit 1
fi

echo "✅ Managed identity enabled"
echo "   Principal ID: $PRINCIPAL_ID"
echo ""

# Step 2: Get Foundry Resource ID
echo "========================================="
echo "Step 2: Getting Foundry Resource ID..."
echo "========================================="
echo ""

RESOURCE_ID=$(az resource show \
  --name "$AI_RESOURCE_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --resource-type "Microsoft.CognitiveServices/accounts" \
  --query id \
  --output tsv 2>/dev/null)

if [ -z "$RESOURCE_ID" ]; then
  echo "❌ Could not find Foundry resource: $AI_RESOURCE_NAME"
  echo "Troubleshooting:"
  echo "  1. Verify resource name is correct"
  echo "  2. Check resource group: $RESOURCE_GROUP"
  echo "  3. Try: az resource list --resource-group $RESOURCE_GROUP --resource-type Microsoft.CognitiveServices/accounts"
  exit 1
fi

echo "✅ Found Foundry resource"
echo "   Resource ID: $RESOURCE_ID"
echo ""

# Step 3: Assign RBAC Roles
echo "========================================="
echo "Step 3: Assigning RBAC Roles..."
echo "========================================="
echo ""

ROLES=("Azure AI User" "Cognitive Services User" "Cognitive Services OpenAI Contributor")

for ROLE_NAME in "${ROLES[@]}"; do
  echo "Checking role: $ROLE_NAME"
  
  # Check if role already assigned
  EXISTING=$(az role assignment list \
    --assignee "$PRINCIPAL_ID" \
    --scope "$RESOURCE_ID" \
    --role "$ROLE_NAME" \
    --query "[0].id" \
    --output tsv 2>/dev/null || echo "")

  if [ -n "$EXISTING" ] && [ "$EXISTING" != "null" ]; then
    echo "  ✅ Already assigned"
  else
    echo "  Granting role..."
    az role assignment create \
      --assignee "$PRINCIPAL_ID" \
      --role "$ROLE_NAME" \
      --scope "$RESOURCE_ID" \
      --output json > /dev/null 2>&1
    
    if [ $? -eq 0 ]; then
      echo "  ✅ Granted"
    else
      echo "  ⚠️  Could not grant (trying resource group scope)"
      az role assignment create \
        --assignee "$PRINCIPAL_ID" \
        --role "$ROLE_NAME" \
        --resource-group "$RESOURCE_GROUP" \
        --output json > /dev/null 2>&1
      
      if [ $? -eq 0 ]; then
        echo "  ✅ Granted at resource group scope"
      else
        echo "  ⚠️  Failed to grant"
      fi
    fi
  fi
done
echo ""

# Wait for propagation
echo "========================================="
echo "Waiting for role propagation..."
echo "========================================="
sleep 10
for i in {1..6}; do
  printf "  ⏳ %d/60 seconds..." $((i*10))
  sleep 10
  printf "\r"
done
echo "  ✅ Propagation complete"
echo ""

# Summary
echo "========================================="
echo "✅ Setup Complete!"
echo "========================================="
echo ""
echo "Next steps:"
echo "  1. Update web app configuration:"
echo "     - Verify FOUNDRY_ENDPOINT is set"
echo "     - Remove or keep FOUNDRY_API_KEY (optional)"
echo ""
echo "  2. Deploy the updated code:"
echo "     git add ."
echo "     git commit -m 'Enable managed identity for Foundry'"
echo "     git push origin main"
echo ""
echo "  3. Verify it works:"
echo "     - Visit https://${WEBAPP_NAME}.azurewebsites.net"
echo "     - Upload a document"
echo "     - Try to query it"
echo "     - Check logs for 'Auth method: Managed Identity'"
echo ""
echo "Reference: See MANAGED_IDENTITY_SETUP.md for more details"
echo ""
