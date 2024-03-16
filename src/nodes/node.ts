import bodyParser from "body-parser";
import express from "express";
import { BASE_NODE_PORT } from "../config"; // Importation de la configuration de base du port des noeuds
import { NodeState, Value } from "../types"; // Types utilisés pour définir l'état des noeuds et les valeurs
import http from "http"; // Module HTTP pour les requêtes
import { delay } from "../utils"; // Fonction de délai importée depuis les utilitaires
import { Application } from "express";
import { CookieOptions } from "express";
import { json } from "express";

// Fonction asynchrone principale pour un noeud du réseau
export async function node(
  nodeId: number, // ID du noeud
  N: number, // Nombre total de noeuds dans le réseau
  F: number, // Nombre de noeuds défectueux dans le réseau
  initialValue: Value, // Valeur initiale du noeud
  isFaulty: boolean, // Vrai si le noeud est défectueux, faux sinon
  nodesAreReady: () => boolean, // Fonction pour vérifier si tous les noeuds sont prêts à recevoir des requêtes
  setNodeIsReady: (index: number) => void // Cette fonction doit être appelée lorsque le noeud est démarré et prêt à recevoir des requêtes
) {
  const node = express();
  node.use(express.json());
  node.use(bodyParser.json());

  // État initial du noeud
  let currentNodeState: NodeState = {
    killed: false,
    x: null,
    k: null,
    decided: null,
  };

  // Propositions et votes enregistrés par le noeud
  let proposals: Map<number, Value[]> = new Map();
  let votes: Map<number, Value[]> = new Map();

  // Route pour récupérer le statut actuel du noeud
  node.get("/status", (req, res) => {
    res.status(isFaulty ? 500 : 200).send(isFaulty ? "faulty" : "live");
  });

  // Route pour arrêter l'algorithme de consensus
  node.get("/stop", (req, res) => {
    currentNodeState.killed = true;
    res.status(200).send("killed");
  });

  // Route pour obtenir l'état actuel du noeud
  node.get("/getState", (req, res) => {
    res.status(200).send(currentNodeState);
  });

  // Route pour démarrer l'algorithme de consensus
  node.get("/start", async (req, res) => {
    while (!nodesAreReady()) {
      await delay(5); // Attente jusqu'à ce que tous les noeuds soient prêts
    }
    if (!isFaulty) {
      // Initialisation de l'état pour lancer l'algorithme si le noeud n'est pas défectueux
      currentNodeState = { k: 1, x: initialValue, decided: false, killed: currentNodeState.killed };
      for (let i = 0; i < N; i++) {
        // Envoi du message de proposition à tous les noeuds
        sendMessage(`http://localhost:${BASE_NODE_PORT + i}/message`, { k: currentNodeState.k, x: currentNodeState.x, messageType: "propose" });
      }
    } else {
      // Le noeud défectueux n'initialise pas correctement son état
      currentNodeState = { k: null, x: null, decided: null, killed: currentNodeState.killed };
    }

    res.status(200).send("L'algorithme de consensus a démarré.");
  });

  // Route pour permettre au noeud de recevoir des messages d'autres noeuds
  node.post("/message", async (req, res) => {
    let { k, x, messageType } = req.body;
    if (!isFaulty && !currentNodeState.killed) {
      if (messageType == "propose") {
        // Traitement des propositions
        if (!proposals.has(k)) {
          proposals.set(k, []);
        }
        proposals.get(k)!.push(x);
        let proposal = proposals.get(k)!;
        if (proposal.length >= (N - F)) {
          // Décision basée sur le nombre de propositions
          let count0 = proposal.filter((el) => el == 0).length;
          let count1 = proposal.filter((el) => el == 1).length;
          if (count0 > (N / 2)) {
            x = 0;
          } else if (count1 > (N / 2)) {
            x = 1;
          } else {
            x = "?";
          }
          for (let i = 0; i < N; i++) {
            // Envoi du vote
            sendMessage(`http://localhost:${BASE_NODE_PORT + i}/message`, { k: k, x: x, messageType: "vote" });
          }
        }
      } else if (messageType == "vote") {
        // Traitement des votes
        if (!votes.has(k)) {
          votes.set(k, []);
        }
        votes.get(k)!.push(x);
        let vote = votes.get(k)!;
        if (vote.length >= (N - F)) {
          // Décision finale basée sur les votes
          let count0 = vote.filter((el) => el == 0).length;
          let count1 = vote.filter((el) => el == 1).length;

          if (count0 >= F + 1) {
            currentNodeState.x = 0;
            currentNodeState.decided = true;
          } else if (count1 >= F + 1) {
            currentNodeState.x = 1;
            currentNodeState.decided = true;
          } else {
            // Si aucun consensus clair, choix aléatoire
            currentNodeState.x = Math.random() > 0.5 ? 0 : 1;
            currentNodeState.k = k + 1;

            // Nouveau tour de proposition
            for (let i = 0; i < N; i++) {
              sendMessage(`http://localhost:${BASE_NODE_PORT + i}/message`, { k: currentNodeState.k, x: currentNodeState.x, messageType: "propose" });
            }
          }
        }
      }
    }
    res.status(200).send("Message reçu et traité.");
  });

  // Démarrage du serveur
  const server = node.listen(BASE_NODE_PORT + nodeId, async () => {
    console.log(`Noeud ${nodeId} écoute sur le port ${BASE_NODE_PORT + nodeId}`);

    // Indication que le noeud est prêt
    setNodeIsReady(nodeId);
  });

  return server;
}

// Fonction pour envoyer des messages à d'autres noeuds
function sendMessage(url: string, body: any) {
  const options = {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    }
  };
  const req = http.request(url, options, (res) => {
    let data = '';
    res.on('data', (chunk) => {
      data += chunk;
    });
    res.on('end', () => {
      try {
        // Tentative de traitement de la réponse en JSON
        const contentType = res.headers['content-type'];
        if (contentType && contentType.includes('application/json')) {
          const jsonData = JSON.parse(data);
        }
      } catch (error) {}
    });
  });
  req.on('error', (error) => {});
  req.write(JSON.stringify(body));
  req.end();
}
