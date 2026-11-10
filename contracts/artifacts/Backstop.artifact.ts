export default {
  "contractName": "Backstop",
  "constructorInputs": [
    {
      "name": "ownerPkh",
      "type": "bytes20"
    },
    {
      "name": "loanKeyCategory",
      "type": "bytes32"
    },
    {
      "name": "paryonTokenId",
      "type": "bytes32"
    },
    {
      "name": "manageLockingBytecode",
      "type": "bytes"
    },
    {
      "name": "triggerRatioBps",
      "type": "int"
    },
    {
      "name": "targetRatioBps",
      "type": "int"
    },
    {
      "name": "maxTopUpSats",
      "type": "int"
    },
    {
      "name": "maxOverheadSats",
      "type": "int"
    },
    {
      "name": "cooldownBlocks",
      "type": "int"
    }
  ],
  "abi": [
    {
      "name": "rescue",
      "inputs": []
    },
    {
      "name": "ownerSpend",
      "inputs": [
        {
          "name": "ownerPubKey",
          "type": "pubkey"
        },
        {
          "name": "ownerSig",
          "type": "sig"
        }
      ]
    }
  ],
  "bytecode": "OP_9 OP_PICK OP_0 OP_NUMEQUAL OP_IF OP_INPUTINDEX OP_4 OP_NUMEQUAL OP_IF OP_5 OP_UTXOBYTECODE OP_4 OP_UTXOBYTECODE OP_EQUALVERIFY OP_ELSE OP_INPUTINDEX OP_5 OP_NUMEQUALVERIFY OP_TXINPUTCOUNT OP_6 OP_NUMEQUALVERIFY OP_TXOUTPUTCOUNT OP_7 OP_LESSTHANOREQUAL OP_VERIFY OP_5 OP_UTXOBYTECODE OP_4 OP_UTXOBYTECODE OP_OVER OP_EQUALVERIFY OP_4 OP_UTXOTOKENCATEGORY OP_3 OP_PICK OP_2 OP_CAT OP_EQUALVERIFY OP_5 OP_UTXOTOKENCATEGORY OP_0 OP_EQUALVERIFY OP_9 OP_PICK OP_CHECKSEQUENCEVERIFY OP_DROP OP_0 OP_UTXOTOKENCATEGORY OP_4 OP_PICK OP_1 OP_CAT OP_EQUALVERIFY OP_0 OP_UTXOTOKENCOMMITMENT OP_DUP OP_1 OP_SPLIT OP_DROP 00 OP_EQUALVERIFY OP_0 OP_OUTPUTBYTECODE OP_0 OP_UTXOBYTECODE OP_EQUALVERIFY OP_0 OP_OUTPUTTOKENCATEGORY OP_0 OP_UTXOTOKENCATEGORY OP_EQUALVERIFY OP_0 OP_OUTPUTTOKENCOMMITMENT OP_OVER OP_EQUALVERIFY OP_0 OP_OUTPUTTOKENAMOUNT OP_0 OP_NUMEQUALVERIFY OP_DUP OP_9 OP_SPLIT OP_DROP OP_5 OP_SPLIT OP_NIP OP_BIN2NUM OP_DUP OP_0 OP_GREATERTHAN OP_VERIFY OP_2 OP_UTXOTOKENCATEGORY OP_5 OP_PICK OP_EQUALVERIFY OP_1 OP_UTXOTOKENCATEGORY OP_6 OP_PICK OP_1 OP_CAT OP_EQUALVERIFY OP_1 OP_OUTPOINTTXHASH OP_2 OP_OUTPOINTTXHASH OP_EQUALVERIFY OP_2 OP_OUTPOINTINDEX OP_1 OP_OUTPOINTINDEX OP_1ADD OP_NUMEQUALVERIFY OP_1 OP_UTXOTOKENCOMMITMENT OP_DUP OP_1 OP_SPLIT OP_DROP OP_1 OP_EQUALVERIFY OP_1 OP_OUTPUTBYTECODE OP_1 OP_UTXOBYTECODE OP_EQUALVERIFY OP_1 OP_OUTPUTTOKENCATEGORY OP_1 OP_UTXOTOKENCATEGORY OP_EQUALVERIFY OP_1 OP_OUTPUTTOKENCOMMITMENT OP_OVER OP_EQUALVERIFY OP_1 OP_OUTPUTTOKENAMOUNT OP_0 OP_NUMEQUALVERIFY OP_2 OP_OUTPUTBYTECODE OP_2 OP_UTXOBYTECODE OP_EQUALVERIFY OP_2 OP_OUTPUTTOKENCATEGORY OP_2 OP_UTXOTOKENCATEGORY OP_EQUALVERIFY OP_2 OP_OUTPUTTOKENCOMMITMENT OP_2 OP_UTXOTOKENCOMMITMENT OP_EQUALVERIFY OP_3 OP_UTXOBYTECODE OP_8 OP_PICK OP_EQUALVERIFY OP_3 OP_UTXOTOKENCATEGORY OP_7 OP_PICK OP_EQUALVERIFY OP_3 OP_UTXOTOKENCOMMITMENT OP_2 OP_EQUALVERIFY OP_3 OP_OUTPUTBYTECODE OP_8 OP_PICK OP_EQUALVERIFY OP_3 OP_OUTPUTTOKENCATEGORY OP_3 OP_UTXOTOKENCATEGORY OP_EQUALVERIFY OP_3 OP_OUTPUTTOKENCOMMITMENT OP_2 OP_EQUALVERIFY OP_1 OP_UTXOVALUE OP_1 OP_OUTPUTVALUE OP_2DUP OP_SWAP OP_SUB OP_DUP OP_0 OP_GREATERTHAN OP_VERIFY OP_DUP OP_14 OP_PICK OP_LESSTHANOREQUAL OP_VERIFY OP_4 OP_OUTPUTBYTECODE OP_7 OP_PICK OP_EQUALVERIFY OP_4 OP_OUTPUTTOKENCATEGORY OP_4 OP_UTXOTOKENCATEGORY OP_EQUALVERIFY OP_4 OP_OUTPUTTOKENCOMMITMENT OP_4 OP_UTXOTOKENCOMMITMENT OP_EQUALVERIFY OP_4 OP_OUTPUTVALUE OP_4 OP_UTXOVALUE OP_NUMEQUALVERIFY OP_5 OP_OUTPUTBYTECODE OP_7 OP_PICK OP_EQUALVERIFY OP_5 OP_OUTPUTTOKENCATEGORY OP_0 OP_EQUALVERIFY OP_5 OP_OUTPUTVALUE OP_5 OP_UTXOVALUE OP_2 OP_PICK OP_SUB OP_16 OP_PICK OP_SUB OP_GREATERTHANOREQUAL OP_VERIFY OP_TXOUTPUTCOUNT OP_7 OP_NUMEQUAL OP_IF OP_6 OP_OUTPUTTOKENCATEGORY OP_0 OP_EQUALVERIFY OP_ENDIF OP_3 OP_PICK OP_7 OP_SPLIT OP_DROP OP_1 OP_SPLIT OP_NIP OP_BIN2NUM OP_DUP 00e1f505 OP_MUL OP_4 OP_PICK OP_7 OP_PICK OP_MUL 1027 OP_MUL OP_14 OP_PICK OP_2 OP_PICK OP_MUL OP_LESSTHAN OP_VERIFY OP_3 OP_PICK OP_7 OP_PICK OP_MUL 1027 OP_MUL OP_15 OP_PICK OP_2 OP_PICK OP_MUL OP_LESSTHANOREQUAL OP_VERIFY OP_3 OP_PICK OP_7 OP_PICK OP_MUL 1027 OP_MUL OP_14 OP_PICK OP_2 OP_PICK OP_MUL OP_GREATERTHANOREQUAL OP_3 OP_PICK 11 OP_PICK OP_NUMEQUAL OP_5 OP_UTXOVALUE OP_5 OP_PICK OP_SUB 13 OP_PICK d007 OP_ADD OP_LESSTHANOREQUAL OP_2 OP_PICK OP_2 OP_PICK OP_BOOLOR OP_OVER OP_BOOLOR OP_VERIFY OP_2DROP OP_2DROP OP_2DROP OP_2DROP OP_2DROP OP_2DROP OP_ENDIF OP_2DROP OP_2DROP OP_2DROP OP_2DROP OP_2DROP OP_1 OP_ELSE OP_9 OP_ROLL OP_1 OP_NUMEQUALVERIFY OP_9 OP_PICK OP_HASH160 OP_EQUALVERIFY OP_9 OP_ROLL OP_9 OP_ROLL OP_CHECKSIGVERIFY OP_2DROP OP_2DROP OP_2DROP OP_2DROP OP_1 OP_ENDIF",
  "source": "pragma cashscript ^0.14.0;\n\n// Backstop: a pre-funded rescue for one ParyonUSD loan.\n//\n// A vault is two UTXOs locked by this contract:\n//   - the key UTXO:     1000 sats + the loan's minting loan-key NFT\n//   - the reserve UTXO: the borrower's BCH reserve, no tokens\n// Two UTXOs, because Paryon's manage function requires the loan key to come back with\n// exactly the BCH value it went in with (manage.cash:121), so the key UTXO cannot shrink.\n//\n// rescue() is callable by anyone. It only accepts one transaction shape:\n// Paryon's add-collateral transaction (manage with repayAmount 0), with the vault at inputs 4 and 5.\n//\n//   in 0  Paryon price contract (sharePrice)   out 0  price contract, unchanged\n//   in 1  Paryon loan                          out 1  loan, same state, value + topUp\n//   in 2  Paryon loan sidecar                  out 2  loan sidecar, unchanged\n//   in 3  Paryon manage function               out 3  manage function, unchanged\n//   in 4  vault key UTXO                       out 4  vault key UTXO, unchanged\n//   in 5  vault reserve UTXO                   out 5  vault reserve UTXO, value >= in5 - topUp - maxOverhead\n//                                              out 6  optional keeper reward, BCH only\n//\n// Paryon's contracts enforce some of these rules as well. Backstop checks every rule the\n// borrower relies on itself, so no guarantee depends on Paryon's code catching it first.\n//\n// Units: collateral in satoshis, debt in PUSD cents (2 decimals), price in US cents per BCH.\n// Collateral ratio in basis points = collateral * price * 10000 / (debt * 100_000_000).\n\ncontract Backstop(\n    // Borrower's public key hash: the only key that can withdraw from the vault\n    bytes20 ownerPkh,\n    // Token category of the loan key (and loan sidecar): which loan this vault protects\n    bytes32 loanKeyCategory,\n    // Paryon's token category: authenticates the price contract, loan and manage function\n    bytes32 paryonTokenId,\n    // Locking bytecode of Paryon's manage function contract\n    bytes manageLockingBytecode,\n    // A rescue is allowed only while the collateral ratio is below this (e.g. 12500 = 125%)\n    int triggerRatioBps,\n    // A rescue may not lift the collateral ratio above this (e.g. 15000 = 150%)\n    int targetRatioBps,\n    // Most BCH that one rescue may move into the loan\n    int maxTopUpSats,\n    // Most BCH that one rescue may spend on miner fee plus keeper reward\n    int maxOverheadSats,\n    // Minimum age of the reserve UTXO, in blocks, before it can fund a rescue\n    int cooldownBlocks\n) {\n    // Anyone can call this. It moves part of the reserve into the borrower's own loan.\n    function rescue() {\n        if (this.activeInputIndex == 4) {\n            // Key input: the full rule set runs on the reserve input (index 5).\n            // Stops: using the key without the reserve-side checks. Input 5 carries this same\n            // script, so it is either a rescue (all checks below run) or an owner-signed spend.\n            require(tx.inputs[5].lockingBytecode == tx.inputs[4].lockingBytecode, \"Key and reserve must come from the same vault\");\n        } else {\n            require(this.activeInputIndex == 5, \"Vault inputs must be at index 4 and 5\");\n\n            // ---- Transaction shape ----\n            // Stops: extra inputs smuggling in other tokens or authority.\n            require(tx.inputs.length == 6, \"Rescue must have exactly 6 inputs\");\n            // Stops: extra outputs siphoning value or carrying tokens away.\n            require(tx.outputs.length <= 7, \"Rescue may have at most 7 outputs\");\n\n            bytes vaultBytecode = tx.inputs[5].lockingBytecode;\n            // Stops: pairing this reserve with a key UTXO from somewhere else.\n            require(tx.inputs[4].lockingBytecode == vaultBytecode, \"Key must come from this vault\");\n            // Stops: running the rescue with some other loan's key.\n            require(tx.inputs[4].tokenCategory == loanKeyCategory + 0x02, \"Input 4 must be this loan's minting key\");\n            // Stops: key and reserve being swapped between inputs 4 and 5.\n            require(tx.inputs[5].tokenCategory == 0x, \"Reserve input must hold no tokens\");\n\n            // ---- Cooldown ----\n            // Stops: rescues in quick succession. The node rejects the transaction until the\n            // reserve UTXO is this many blocks old (relative timelock, BIP68).\n            require(this.age >= cooldownBlocks, \"Reserve is still in its cooldown\");\n\n            // ---- Price contract (input 0) ----\n            // Stops: a fake price. Only Paryon's price contracts hold a mutable Paryon NFT with prefix 0x00.\n            require(tx.inputs[0].tokenCategory == paryonTokenId + 0x01, \"Input 0 must be a Paryon price contract\");\n            bytes priceState = tx.inputs[0].nftCommitment;\n            require(priceState.split(1)[0] == 0x00, \"Input 0 must be a Paryon price contract\");\n            // Stops: a migrated price contract leaking tokens or changing state in this transaction.\n            require(tx.outputs[0].lockingBytecode == tx.inputs[0].lockingBytecode, \"Price contract must be returned unchanged\");\n            require(tx.outputs[0].tokenCategory == tx.inputs[0].tokenCategory, \"Price contract must be returned unchanged\");\n            require(tx.outputs[0].nftCommitment == priceState, \"Price contract must be returned unchanged\");\n            require(tx.outputs[0].tokenAmount == 0, \"Price contract must be returned unchanged\");\n            int price = int(priceState.slice(5, 9));\n            // Stops: a zero or negative price making every ratio look low.\n            require(price > 0, \"Price must be positive\");\n\n            // ---- Loan (input 1) and its sidecar (input 2) ----\n            // Stops: topping up a loan that is not this borrower's. The sidecar carries the loan-key\n            // category, and Paryon creates it in the output right after its loan.\n            require(tx.inputs[2].tokenCategory == loanKeyCategory, \"Input 2 must be this loan's sidecar\");\n            require(tx.inputs[1].tokenCategory == paryonTokenId + 0x01, \"Input 1 must be a Paryon loan\");\n            require(tx.inputs[1].outpointTransactionHash == tx.inputs[2].outpointTransactionHash, \"Input 1 must be the loan of this sidecar\");\n            require(tx.inputs[2].outpointIndex == tx.inputs[1].outpointIndex + 1, \"Input 1 must be the loan of this sidecar\");\n            bytes loanState = tx.inputs[1].nftCommitment;\n            require(loanState.split(1)[0] == 0x01, \"Input 1 must be a Paryon loan\");\n\n            // Stops: moving the loan elsewhere.\n            require(tx.outputs[1].lockingBytecode == tx.inputs[1].lockingBytecode, \"Loan must stay in the Paryon loan contract\");\n            require(tx.outputs[1].tokenCategory == tx.inputs[1].tokenCategory, \"Loan must stay in the Paryon loan contract\");\n            // Stops: increasing debt, repaying with someone else's PUSD, or changing the interest manager.\n            // The loan state must be byte-for-byte unchanged.\n            require(tx.outputs[1].nftCommitment == loanState, \"Loan state must not change\");\n            require(tx.outputs[1].tokenAmount == 0, \"Loan must not receive tokens\");\n            // Stops: the sidecar being moved or altered.\n            require(tx.outputs[2].lockingBytecode == tx.inputs[2].lockingBytecode, \"Loan sidecar must be returned unchanged\");\n            require(tx.outputs[2].tokenCategory == tx.inputs[2].tokenCategory, \"Loan sidecar must be returned unchanged\");\n            require(tx.outputs[2].nftCommitment == tx.inputs[2].nftCommitment, \"Loan sidecar must be returned unchanged\");\n\n            // ---- Paryon manage function (input 3) ----\n            // Stops: some other loan function (Loan.cash checks only category and commitment length).\n            require(tx.inputs[3].lockingBytecode == manageLockingBytecode, \"Input 3 must be Paryon's manage function\");\n            require(tx.inputs[3].tokenCategory == paryonTokenId, \"Input 3 must be Paryon's manage function\");\n            require(tx.inputs[3].nftCommitment == 0x02, \"Input 3 must be Paryon's manage function\");\n            // Stops: output 3 carrying a copy of the loan key instead of the manage function NFT.\n            require(tx.outputs[3].lockingBytecode == manageLockingBytecode, \"Manage function must be returned unchanged\");\n            require(tx.outputs[3].tokenCategory == tx.inputs[3].tokenCategory, \"Manage function must be returned unchanged\");\n            require(tx.outputs[3].nftCommitment == 0x02, \"Manage function must be returned unchanged\");\n\n            // ---- Top-up amount ----\n            int collateralBefore = tx.inputs[1].value;\n            int collateralAfter = tx.outputs[1].value;\n            int topUp = collateralAfter - collateralBefore;\n            // Stops: withdrawing collateral with the key.\n            require(topUp > 0, \"Rescue must add collateral\");\n            // Stops: draining the reserve into one rescue.\n            require(topUp <= maxTopUpSats, \"Top-up is above the vault's limit\");\n\n            // ---- Key comes straight back ----\n            // Stops: stealing the key, or returning it with a changed commitment or capability.\n            require(tx.outputs[4].lockingBytecode == vaultBytecode, \"Loan key must return to the vault\");\n            require(tx.outputs[4].tokenCategory == tx.inputs[4].tokenCategory, \"Loan key must return unchanged\");\n            require(tx.outputs[4].nftCommitment == tx.inputs[4].nftCommitment, \"Loan key must return unchanged\");\n            require(tx.outputs[4].value == tx.inputs[4].value, \"Loan key must return unchanged\");\n\n            // ---- Reserve comes back, minus the top-up and capped overhead ----\n            // Stops: the remaining reserve going anywhere but the vault.\n            require(tx.outputs[5].lockingBytecode == vaultBytecode, \"Remaining reserve must return to the vault\");\n            require(tx.outputs[5].tokenCategory == 0x, \"Remaining reserve must hold no tokens\");\n            // Stops: a keeper taking more than the fee cap.\n            require(tx.outputs[5].value >= tx.inputs[5].value - topUp - maxOverheadSats, \"Fee and keeper reward exceed the vault's limit\");\n\n            // ---- Optional keeper reward ----\n            // Stops: minting a copy of the loan key (it is a minting NFT) and sending it out.\n            if (tx.outputs.length == 7) {\n                require(tx.outputs[6].tokenCategory == 0x, \"Keeper reward must hold no tokens\");\n            }\n\n            // ---- Collateral ratio ----\n            int debt = int(loanState.slice(1, 7));\n            int ratioScale = debt * 100_000_000;\n            // Stops: rescuing a loan that is not in danger.\n            require(collateralBefore * price * 10000 < triggerRatioBps * ratioScale, \"Loan is not below the trigger ratio\");\n            // Stops: overfunding the loan beyond what the borrower asked for.\n            require(collateralAfter * price * 10000 <= targetRatioBps * ratioScale, \"Rescue would lift the loan above the target ratio\");\n            // Stops: a keeper draining the reserve through many tiny rescues, each paying the overhead.\n            // A rescue must lift the loan out of the trigger zone, unless it uses the full per-rescue\n            // limit or the reserve is used up.\n            bool liftedAboveTrigger = collateralAfter * price * 10000 >= triggerRatioBps * ratioScale;\n            bool usedMaxTopUp = topUp == maxTopUpSats;\n            bool reserveUsedUp = tx.inputs[5].value - topUp <= maxOverheadSats + 2000;\n            require(liftedAboveTrigger || usedMaxTopUp || reserveUsedUp, \"Rescue too small: must lift the loan above the trigger\");\n        }\n    }\n\n    // The borrower can always take the key and the reserve back, with no other restriction.\n    function ownerSpend(pubkey ownerPubKey, sig ownerSig) {\n        // Stops: anyone but the borrower withdrawing.\n        require(hash160(ownerPubKey) == ownerPkh, \"Only the vault owner can withdraw\");\n        require(checkSig(ownerSig, ownerPubKey), \"Only the vault owner can withdraw\");\n    }\n}\n",
  "fingerprint": "adedc52636e5fe9c17e0afb89d119977bbbb31ad9b254d47389c45765bffe89e",
  "debug": {
    "bytecode": "5979009c63c0549c6355c754c78867c0559dc3569dc457a16955c754c7788854ce5379527e8855ce00885979b27500ce5479517e8800cf76517f7501008800cd00c78800d100ce8800d2788800d3009d76597f75557f77817600a06952ce55798851ce5679517e8851c852c88852c951c98b9d51cf76517f75518851cd51c78851d151ce8851d2788851d3009d52cd52c78852d152ce8852d252cf8853c758798853ce57798853cf528853cd58798853d153ce8853d2528851c651cc6e7c947600a069765e79a16954cd57798854d154ce8854d254cf8854cc54c69d55cd57798855d1008855cc55c6527994607994a269c4579c6356d10088685379577f75517f7781760400e1f505955479577995021027955e795279959f695379577995021027955f79527995a1695379577995021027955e79527995a253790111799c55c655799401137902d00793a1527952799b789b696d6d6d6d6d6d686d6d6d6d6d5167597a519d5979a988597a597aad6d6d6d6d5168",
    "sourceMap": "49:4:167:5;;;;;50:12:50:33;:37::38;:12:::1;:40:55:9:0;54:30:54:31;:20::48:1;:62::63:0;:52::80:1;:12::131;55:15:166:9:0;56:20:56:41;:45::46;:12::89:1;60:20:60:36:0;:40::41;:12::80:1;62:20:62:37:0;:41::42;:20:::1;:12::81;64:44:64:45:0;:34::62:1;66:30:66:31:0;:20::48:1;:52::65:0;:12::100:1;68:30:68:31:0;:20::46:1;:50::65:0;;:68::72;:50:::1;:12::117;70:30:70:31:0;:20::46:1;:50::52:0;:12::91:1;75:32:75:46:0;;:12::84:1;;79:30:79:31:0;:20::46:1;:50::63:0;;:66::70;:50:::1;:12::115;80:41:80:42:0;:31::57:1;81:20:81:30:0;:37::38;:20::39:1;:::42;:46::50:0;:12::95:1;83:31:83:32:0;:20::49:1;:63::64:0;:53::81:1;:12::128;84:31:84:32:0;:20::47:1;:61::62:0;:51::77:1;:12::124;85:31:85:32:0;:20::47:1;:51::61:0;:12::108:1;86:31:86:32:0;:20::45:1;:49::50:0;:12::97:1;87:28:87:38:0;:48::49;:28::50:1;;:45::46:0;:28::50:1;;:24::51;89:20:89:25:0;:28::29;:20:::1;:12::57;94:30:94:31:0;:20::46:1;:50::65:0;;:12::106:1;95:30:95:31:0;:20::46:1;:50::63:0;;:66::70;:50:::1;:12::105;96:30:96:31:0;:20::56:1;:70::71:0;:60::96:1;:12::142;97:30:97:31:0;:20::46:1;:60::61:0;:50::76:1;:::80;:12::126;98:40:98:41:0;:30::56:1;99:20:99:29:0;:36::37;:20::38:1;:::41;:45::49:0;:12::84:1;102:31:102:32:0;:20::49:1;:63::64:0;:53::81:1;:12::129;103:31:103:32:0;:20::47:1;:61::62:0;:51::77:1;:12::125;106:31:106:32:0;:20::47:1;:51::60:0;:12::92:1;107:31:107:32:0;:20::45:1;:49::50:0;:12::84:1;109:31:109:32:0;:20::49:1;:63::64:0;:53::81:1;:12::126;110:31:110:32:0;:20::47:1;:61::62:0;:51::77:1;:12::122;111:31:111:32:0;:20::47:1;:61::62:0;:51::77:1;:12::122;115:30:115:31:0;:20::48:1;:52::73:0;;:12::119:1;116:30:116:31:0;:20::46:1;:50::63:0;;:12::109:1;117:30:117:31:0;:20::46:1;:50::54:0;:12::100:1;119:31:119:32:0;:20::49:1;:53::74:0;;:12::122:1;120:31:120:32:0;:20::47:1;:61::62:0;:51::77:1;:12::125;121:31:121:32:0;:20::47:1;:51::55:0;:12::103:1;124:45:124:46:0;:35::53:1;125:45:125:46:0;:34::53:1;126:24:126:58:0;;::::1;128:20:128:25:0;:28::29;:20:::1;:12::61;130:20:130:25:0;:29::41;;:20:::1;:12::80;134:31:134:32:0;:20::49:1;:53::66:0;;:12::105:1;135:31:135:32:0;:20::47:1;:61::62:0;:51::77:1;:12::113;136:31:136:32:0;:20::47:1;:61::62:0;:51::77:1;:12::113;137:31:137:32:0;:20::39:1;:53::54:0;:43::61:1;:12::97;141:31:141:32:0;:20::49:1;:53::66:0;;:12::114:1;142:31:142:32:0;:20::47:1;:51::53:0;:12::96:1;144:31:144:32:0;:20::39:1;:53::54:0;:43::61:1;:64::69:0;;:43:::1;:72::87:0;;:43:::1;:20;:12::139;148:16:148:33:0;:37::38;:16:::1;:40:150:13:0;149:35:149:36;:24::51:1;:55::57:0;:16::96:1;148:40:150:13;153:27:153:36:0;;:46::47;:27::48:1;;:43::44:0;:27::48:1;;:23::49;154:29:154:33:0;:36::47;:29:::1;156:20:156:36:0;;:39::44;;:20:::1;:47::52:0;:20:::1;:55::70:0;;:73::83;;:55:::1;:20;:12::124;158:20:158:35:0;;:38::43;;:20:::1;:46::51:0;:20:::1;:55::69:0;;:72::82;;:55:::1;:20;:12::137;162:38:162:53:0;;:56::61;;:38:::1;:64::69:0;:38:::1;:73::88:0;;:91::101;;:73:::1;:38;163:32:163:37:0;;:41::53;;:32:::1;164:43:164:44:0;:33::51:1;:54::59:0;;:33:::1;:63::78:0;;:81::85;:63:::1;:33;165:20:165:38:0;;:42::54;;:20:::1;:58::71:0;:20:::1;:12::131;55:15:166:9;;;;;;;49:22:167:5;;;;;;:4;170::174::0;;;;172:24:172:35;;:16::36:1;:8::87;173:25:173:33:0;;:35::46;;:8::86:1;170:58:174:5;;;;;28:0:175:1",
    "logs": [],
    "requires": [
      {
        "ip": 22,
        "line": 54,
        "message": "Key and reserve must come from the same vault"
      },
      {
        "ip": 26,
        "line": 56,
        "message": "Vault inputs must be at index 4 and 5"
      },
      {
        "ip": 29,
        "line": 60,
        "message": "Rescue must have exactly 6 inputs"
      },
      {
        "ip": 33,
        "line": 62,
        "message": "Rescue may have at most 7 outputs"
      },
      {
        "ip": 39,
        "line": 66,
        "message": "Key must come from this vault"
      },
      {
        "ip": 46,
        "line": 68,
        "message": "Input 4 must be this loan's minting key"
      },
      {
        "ip": 50,
        "line": 70,
        "message": "Reserve input must hold no tokens"
      },
      {
        "ip": 53,
        "line": 75,
        "message": "Reserve is still in its cooldown"
      },
      {
        "ip": 61,
        "line": 79,
        "message": "Input 0 must be a Paryon price contract"
      },
      {
        "ip": 69,
        "line": 81,
        "message": "Input 0 must be a Paryon price contract"
      },
      {
        "ip": 74,
        "line": 83,
        "message": "Price contract must be returned unchanged"
      },
      {
        "ip": 79,
        "line": 84,
        "message": "Price contract must be returned unchanged"
      },
      {
        "ip": 83,
        "line": 85,
        "message": "Price contract must be returned unchanged"
      },
      {
        "ip": 87,
        "line": 86,
        "message": "Price contract must be returned unchanged"
      },
      {
        "ip": 99,
        "line": 89,
        "message": "Price must be positive"
      },
      {
        "ip": 104,
        "line": 94,
        "message": "Input 2 must be this loan's sidecar"
      },
      {
        "ip": 111,
        "line": 95,
        "message": "Input 1 must be a Paryon loan"
      },
      {
        "ip": 116,
        "line": 96,
        "message": "Input 1 must be the loan of this sidecar"
      },
      {
        "ip": 122,
        "line": 97,
        "message": "Input 1 must be the loan of this sidecar"
      },
      {
        "ip": 130,
        "line": 99,
        "message": "Input 1 must be a Paryon loan"
      },
      {
        "ip": 135,
        "line": 102,
        "message": "Loan must stay in the Paryon loan contract"
      },
      {
        "ip": 140,
        "line": 103,
        "message": "Loan must stay in the Paryon loan contract"
      },
      {
        "ip": 144,
        "line": 106,
        "message": "Loan state must not change"
      },
      {
        "ip": 148,
        "line": 107,
        "message": "Loan must not receive tokens"
      },
      {
        "ip": 153,
        "line": 109,
        "message": "Loan sidecar must be returned unchanged"
      },
      {
        "ip": 158,
        "line": 110,
        "message": "Loan sidecar must be returned unchanged"
      },
      {
        "ip": 163,
        "line": 111,
        "message": "Loan sidecar must be returned unchanged"
      },
      {
        "ip": 168,
        "line": 115,
        "message": "Input 3 must be Paryon's manage function"
      },
      {
        "ip": 173,
        "line": 116,
        "message": "Input 3 must be Paryon's manage function"
      },
      {
        "ip": 177,
        "line": 117,
        "message": "Input 3 must be Paryon's manage function"
      },
      {
        "ip": 182,
        "line": 119,
        "message": "Manage function must be returned unchanged"
      },
      {
        "ip": 187,
        "line": 120,
        "message": "Manage function must be returned unchanged"
      },
      {
        "ip": 191,
        "line": 121,
        "message": "Manage function must be returned unchanged"
      },
      {
        "ip": 202,
        "line": 128,
        "message": "Rescue must add collateral"
      },
      {
        "ip": 207,
        "line": 130,
        "message": "Top-up is above the vault's limit"
      },
      {
        "ip": 212,
        "line": 134,
        "message": "Loan key must return to the vault"
      },
      {
        "ip": 217,
        "line": 135,
        "message": "Loan key must return unchanged"
      },
      {
        "ip": 222,
        "line": 136,
        "message": "Loan key must return unchanged"
      },
      {
        "ip": 227,
        "line": 137,
        "message": "Loan key must return unchanged"
      },
      {
        "ip": 232,
        "line": 141,
        "message": "Remaining reserve must return to the vault"
      },
      {
        "ip": 236,
        "line": 142,
        "message": "Remaining reserve must hold no tokens"
      },
      {
        "ip": 248,
        "line": 144,
        "message": "Fee and keeper reward exceed the vault's limit"
      },
      {
        "ip": 256,
        "line": 149,
        "message": "Keeper reward must hold no tokens"
      },
      {
        "ip": 283,
        "line": 156,
        "message": "Loan is not below the trigger ratio"
      },
      {
        "ip": 297,
        "line": 158,
        "message": "Rescue would lift the loan above the target ratio"
      },
      {
        "ip": 333,
        "line": 165,
        "message": "Rescue too small: must lift the loan above the trigger"
      },
      {
        "ip": 355,
        "line": 172,
        "message": "Only the vault owner can withdraw"
      },
      {
        "ip": 360,
        "line": 173,
        "message": "Only the vault owner can withdraw"
      }
    ],
    "sourceTags": "325:330:sc"
  },
  "compiler": {
    "name": "cashc",
    "version": "0.14.0",
    "options": {
      "enforceFunctionParameterTypes": true,
      "enforceLocktimeGuard": true
    }
  },
  "updatedAt": "2026-11-10T22:42:42.433Z"
} as const;
