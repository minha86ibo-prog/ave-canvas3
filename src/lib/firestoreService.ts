import { auth, db } from '../firebase';
import { 
  collection, 
  doc, 
  getDoc, 
  getDocs, 
  setDoc, 
  updateDoc, 
  addDoc, 
  onSnapshot, 
  query, 
  where, 
  orderBy,
  getDocFromServer,
  Timestamp
} from 'firebase/firestore';

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId: string | undefined;
    email: string | null | undefined;
    emailVerified: boolean | undefined;
    isAnonymous: boolean | undefined;
    tenantId: string | null | undefined;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    },
    operationType,
    path
  }
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

export async function testFirestoreConnection() {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if(error instanceof Error && error.message.includes('the client is offline')) {
      console.error("Please check your Firebase configuration.");
    }
  }
}

export const firestoreService = {
  async getUser(uid: string) {
    const path = `users/${uid}`;
    try {
      const snap = await getDoc(doc(db, 'users', uid));
      return snap.exists() ? snap.data() : null;
    } catch (error) {
      handleFirestoreError(error, OperationType.GET, path);
    }
  },

  async createUser(uid: string, data: any) {
    const path = `users/${uid}`;
    try {
      await setDoc(doc(db, 'users', uid), {
        ...data,
        createdAt: Timestamp.now()
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, path);
    }
  },

  async createGame(data: any) {
    const path = 'games';
    try {
      const docRef = await addDoc(collection(db, 'games'), {
        ...data,
        createdAt: Timestamp.now()
      });
      return docRef.id;
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, path);
    }
  },

  async updateGame(gameId: string, data: any) {
    if (gameId.startsWith('demo-')) {
      const stored = localStorage.getItem('demoGame');
      const game = stored ? JSON.parse(stored) : { id: 'demo-game-id' };
      localStorage.setItem('demoGame', JSON.stringify({ ...game, ...data }));
      return;
    }
    const path = `games/${gameId}`;
    try {
      await updateDoc(doc(db, 'games', gameId), data);
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, path);
    }
  },

  async getGameByCode(code: string) {
    if (code === '000000') {
      return {
        id: 'demo-game-id',
        code: '000000',
        teacherId: 'demo-teacher-id',
        status: 'lobby',
        currentRound: 1,
        maxRounds: 3,
        artworkUrl: 'https://picsum.photos/seed/art1/800/600',
        artworkTitle: '데모 작품: 별이 빛나는 밤'
      };
    }
    const path = 'games';
    try {
      const q = query(collection(db, 'games'), where('code', '==', code), where('status', '!=', 'finished'));
      const snap = await getDocs(q);
      if (snap.empty) return null;
      return { id: snap.docs[0].id, ...snap.docs[0].data() };
    } catch (error) {
      handleFirestoreError(error, OperationType.LIST, path);
    }
  },

  subscribeToGame(gameId: string, callback: (data: any) => void) {
    if (gameId.startsWith('demo-')) {
      const checkDemo = () => {
        const stored = localStorage.getItem('demoGame');
        if (stored) {
          callback(JSON.parse(stored));
        } else {
          callback({
            id: gameId,
            code: '000000',
            teacherId: 'demo-teacher-id',
            status: 'lobby',
            currentRound: 1,
            maxRounds: 3,
            artworkUrl: 'https://picsum.photos/seed/art1/800/600',
            artworkTitle: '데모 작품: 별이 빛나는 밤'
          });
        }
      };
      checkDemo();
      const interval = setInterval(checkDemo, 1000);
      return () => clearInterval(interval);
    }
    const path = `games/${gameId}`;
    return onSnapshot(doc(db, 'games', gameId), (snap) => {
      if (snap.exists()) callback({ id: snap.id, ...snap.data() });
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, path);
    });
  },

  async submitDescription(gameId: string, data: any) {
    if (gameId.startsWith('demo-')) {
      const submission = {
        id: 'sub-' + Math.random().toString(36).substr(2, 9),
        ...data,
        voteCount: 0,
        createdAt: Timestamp.now()
      };
      const key = `demoSubs_${gameId}_${data.roundNumber}`;
      const existing = JSON.parse(localStorage.getItem(key) || '[]');
      existing.push(submission);
      localStorage.setItem(key, JSON.stringify(existing));
      return;
    }
    const path = `games/${gameId}/submissions`;
    try {
      await addDoc(collection(db, 'games', gameId, 'submissions'), {
        ...data,
        voteCount: 0,
        createdAt: Timestamp.now()
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, path);
    }
  },

  subscribeToSubmissions(gameId: string, roundNumber: number, callback: (data: any[]) => void) {
    if (gameId.startsWith('demo-')) {
      const checkSubs = () => {
        const key = `demoSubs_${gameId}_${roundNumber}`;
        const stored = JSON.parse(localStorage.getItem(key) || '[]');
        callback(stored);
      };
      checkSubs();
      const interval = setInterval(checkSubs, 1000);
      return () => clearInterval(interval);
    }
    const path = `games/${gameId}/submissions`;
    const q = query(
      collection(db, 'games', gameId, 'submissions'), 
      where('roundNumber', '==', roundNumber),
      orderBy('createdAt', 'desc')
    );
    return onSnapshot(q, (snap) => {
      callback(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, path);
    });
  },

  async voteForSubmission(gameId: string, submissionId: string) {
    if (gameId.startsWith('demo-')) {
      // Find which round this submission belongs to
      // In demo mode, we'll just check all rounds or assume current round
      // For simplicity, let's look through all demoSubs keys
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key?.startsWith(`demoSubs_${gameId}_`)) {
          const subs = JSON.parse(localStorage.getItem(key) || '[]');
          const subIndex = subs.findIndex((s: any) => s.id === submissionId);
          if (subIndex !== -1) {
            subs[subIndex].voteCount = (subs[subIndex].voteCount || 0) + 1;
            localStorage.setItem(key, JSON.stringify(subs));
            break;
          }
        }
      }
      return;
    }
    const path = `games/${gameId}/submissions/${submissionId}`;
    try {
      const docRef = doc(db, 'games', gameId, 'submissions', submissionId);
      const snap = await getDoc(docRef);
      if (snap.exists()) {
        await updateDoc(docRef, {
          voteCount: (snap.data().voteCount || 0) + 1
        });
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, path);
    }
  },

  async saveResult(gameId: string, data: any) {
    if (gameId.startsWith('demo-')) {
      const key = `demoResults_${gameId}`;
      const existing = JSON.parse(localStorage.getItem(key) || '[]');
      existing.push(data);
      localStorage.setItem(key, JSON.stringify(existing));
      return;
    }
    const path = `games/${gameId}/results`;
    try {
      await addDoc(collection(db, 'games', gameId, 'results'), data);
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, path);
    }
  },

  subscribeToResults(gameId: string, callback: (data: any[]) => void) {
    if (gameId.startsWith('demo-')) {
      const checkResults = () => {
        const key = `demoResults_${gameId}`;
        const stored = JSON.parse(localStorage.getItem(key) || '[]');
        callback(stored);
      };
      checkResults();
      const interval = setInterval(checkResults, 1500);
      return () => clearInterval(interval);
    }
    const path = `games/${gameId}/results`;
    const q = query(collection(db, 'games', gameId, 'results'), orderBy('roundNumber', 'asc'));
    return onSnapshot(q, (snap) => {
      callback(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, path);
    });
  }
};
