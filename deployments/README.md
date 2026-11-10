# Deployments

`chipnet.json` describes where the Paryon contracts used by the demo live on chipnet. It is written by
the chipnet deploy script (Phase 3) and read by the keeper and the web app.

Format (see `keeper/src/config.ts`):

```json
{
  "network": "chipnet",
  "label": "Backstop demo deployment of Paryon's unmodified contracts, DEMO oracle key",
  "paryonTokenId": "<display-order hex>",
  "oraclePublicKey": "<demo oracle public key>",
  "migrationKeyCategory": "<display-order hex>"
}
```

This is not Paryon's own deployment. There is no public Paryon deployment on chipnet (see `docs/PHASE0.md`).
