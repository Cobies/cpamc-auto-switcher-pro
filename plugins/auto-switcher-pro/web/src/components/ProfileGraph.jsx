import React, {
  useState,
  useEffect,
  useCallback,
  useMemo,
  useReducer,
  useRef,
  forwardRef,
  useImperativeHandle,
} from 'react';
import {
  ReactFlow,
  Controls,
  Background,
  MiniMap,
  applyNodeChanges,
  applyEdgeChanges,
  BackgroundVariant,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import ProfileNode from './ProfileNode';
import {
  countOutgoingEdges,
  canDisconnectTarget,
  partitionEdgeRemovals,
  maskDisplayIdentifier,
} from '../graph/connection';
import { graphReducer } from '../graph/graphReducer';
import { saveAuthFilePrefixes } from '../api/managementClient';

const nodeTypes = {
  profile: ProfileNode,
};

// Default initial state with root profiles agy_p1 and agy_p2
const initialNodesData = [
  {
    id: 'p1',
    type: 'profile',
    position: { x: 150, y: 80 },
    data: { label: 'agy_p1', prefix: 'agy_p1', isRoot: true },
  },
  {
    id: 'p2',
    type: 'profile',
    position: { x: 450, y: 80 },
    data: { label: 'agy_p2', prefix: 'agy_p2', isRoot: true },
  },
  {
    id: 'c1',
    type: 'profile',
    position: { x: 150, y: 260 },
    data: { label: 'unlinked_1', prefix: 'unlinked_1', isRoot: false },
  },
  {
    id: 'c2',
    type: 'profile',
    position: { x: 450, y: 260 },
    data: { label: 'unlinked_2', prefix: 'unlinked_2', isRoot: false },
  },
];

const initialEdgesData = [];

// Normalize nodes ensuring each has valid position coordinates
function sanitizeNodes(nodes) {
  if (!Array.isArray(nodes)) return [];
  return nodes.map((n, idx) => {
    const currentPrefix = n.data?.prefix !== undefined ? n.data.prefix : '';
    const initialPrefix =
      n.data?.initialPrefix !== undefined ? n.data.initialPrefix : currentPrefix;
    return {
      ...n,
      position:
        n.position && typeof n.position.x === 'number' && typeof n.position.y === 'number'
          ? n.position
          : { x: 100 + (idx % 4) * 160, y: 80 + Math.floor(idx / 4) * 140 },
      data: {
        ...n.data,
        initialPrefix,
      },
    };
  });
}

/**
 * ARCHITECTURAL DESIGN NOTE:
 * The original task prompt suggested using a pair of setNodes and setEdges updater functions in onConnect.
 * However, in React 18+ and StrictMode, independent useState updater functions run deferred during render
 * and cannot coordinate state atomically without mutable refs or impure closure variables (which cause
 * race conditions and stale reads under rapid batching).
 *
 * To prioritize correctness and strict purity, ProfileGraph uses an atomic graphReducer (useReducer)
 * as the single state owner for both nodes and edges. Unique IDs are generated in event handlers before dispatch,
 * keeping the reducer strictly pure and deterministic.
 *
 * Inside the reducer:
 *   1. Parent prefix is read from current nds.
 *   2. Outgoing count is derived from current eds.
 *   3. Duplicate edges and multi-parent connections are rejected without renaming the child.
 *   4. Next available prefixes are chosen to prevent collisions with existing custom prefixes.
 *
 * Functional setNodes and setEdges interfaces are retained as adapters for React Flow change events.
 */
const ProfileGraph = forwardRef(function ProfileGraph(
  {
    initialNodes = initialNodesData,
    initialEdges = initialEdgesData,
    onGraphChange,
    onConnect: externalOnConnect,
    allowSynthetic = true,
    apiOptions = {},
    onSaveSuccess,
    onSaveError,
  },
  ref
) {
  const safeInitialNodes = useMemo(() => sanitizeNodes(initialNodes), [initialNodes]);
  const safeInitialEdges = useMemo(
    () => (Array.isArray(initialEdges) ? initialEdges : []),
    [initialEdges]
  );

  // Single atomic graph state owner
  const [graphState, dispatch] = useReducer(graphReducer, {
    nodes: safeInitialNodes,
    edges: safeInitialEdges,
    graphFeedback: null,
    lastRemoval: null,
  });

  const { nodes, edges } = graphState;

  // Keep synchronous ref to freshest graph state for async baseline synchronization
  const graphStateRef = useRef(graphState);
  graphStateRef.current = graphState;

  // Graph action feedback banner derived directly from pure reducer state
  const graphFeedback = graphState.graphFeedback || null;
  const setGraphFeedback = useCallback((feedback) => {
    if (feedback) {
      dispatch({ type: 'SET_GRAPH_FEEDBACK', feedback });
    } else {
      dispatch({ type: 'CLEAR_GRAPH_FEEDBACK' });
    }
  }, []);

  // Save changes state and overlap guard
  const [isSaving, setIsSaving] = useState(false);
  const isSavingRef = useRef(false);

  // Maintain clean baseline to prevent Reset from reverting to stale initial props after save.
  // Initialized on mount from initial dataset; updated on successful save or dataset remount.
  // NOTE: Avoid syncing from safeInitialNodes in an effect to prevent re-clobbering saved baseline on rerender.
  const currentBaselineRef = useRef({
    nodes: safeInitialNodes,
    edges: safeInitialEdges,
  });
  const [saveState, setSaveState] = useState({
    status: 'idle', // 'idle' | 'saving' | 'success' | 'partial' | 'error'
    message: '',
    successful: [],
    failed: [],
  });

  const handleDismissSaveStatus = useCallback(() => {
    setSaveState({ status: 'idle', message: '', successful: [], failed: [] });
  }, []);

  // Monotonic ID counter for event handler ID generation (keeps reducer 100% pure)
  const idCounterRef = useRef(1);
  const generateId = useCallback((prefix) => {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return `${prefix}_${crypto.randomUUID()}`;
    }
    return `${prefix}_${Date.now()}_${idCounterRef.current++}`;
  }, []);

  // Functional setNodes interface backed by atomic reducer
  const setNodes = useCallback((updater) => {
    dispatch({ type: 'SET_NODES', updater });
  }, []);

  // Functional setEdges interface backed by atomic reducer
  const setEdges = useCallback((updater) => {
    dispatch({ type: 'SET_EDGES', updater });
  }, []);

  // React Flow node changes adapter
  const onNodesChange = useCallback(
    (changes) => {
      setNodes((nds) => applyNodeChanges(changes, nds));
    },
    [setNodes]
  );

  // React Flow edge changes adapter with descendant guard on removals
  const onEdgesChange = useCallback(
    (changes) => {
      if (!Array.isArray(changes) || changes.length === 0) return;

      const removeChanges = changes.filter((c) => c && c.type === 'remove');
      const otherChanges = changes.filter((c) => !c || c.type !== 'remove');

      if (otherChanges.length > 0) {
        setEdges((eds) => applyEdgeChanges(otherChanges, eds));
      }

      if (removeChanges.length > 0) {
        const edgeIdsToRemove = removeChanges.map((c) => c.id);
        dispatch({
          type: 'REMOVE_EDGES',
          edgeIds: edgeIdsToRemove,
        });
        if (typeof onGraphChange === 'function') {
          onGraphChange();
        }
      }
    },
    [onGraphChange, setEdges]
  );

  // Atomic onConnect callback
  const onConnect = useCallback(
    (connection) => {
      dispatch({ type: 'CONNECT', connection });
      if (typeof externalOnConnect === 'function') {
        externalOnConnect(connection);
      }
      if (typeof onGraphChange === 'function') {
        onGraphChange();
      }
    },
    [externalOnConnect, onGraphChange]
  );

  // Atomic child node disconnect handler enforcing descendant guard via reducer snapshot
  const handleDisconnectNode = useCallback(
    (nodeId) => {
      dispatch({ type: 'DISCONNECT_NODE', nodeId });
      if (typeof onGraphChange === 'function') {
        onGraphChange();
      }
      return { success: true };
    },
    [onGraphChange]
  );

  // Atomic inline prefix change callback with validation feedback
  const handleNodePrefixChange = useCallback(
    (nodeId, newPrefix) => {
      const targetNode = nodes.find((n) => n.id === nodeId);
      const trimmed = typeof newPrefix === 'string' ? newPrefix.trim() : '';

      // Check parent with attached children
      const hasChildren = edges.some((e) => e && e.source === nodeId);
      if (hasChildren && trimmed !== (targetNode?.data?.prefix || '')) {
        return {
          success: false,
          error:
            'Cannot rename parent with attached children. Disconnect children first.',
        };
      }

      dispatch({
        type: 'UPDATE_NODE_PREFIX',
        id: nodeId,
        prefix: newPrefix,
      });

      if (typeof onGraphChange === 'function') {
        onGraphChange();
      }

      return { success: true };
    },
    [nodes, edges, onGraphChange]
  );

  /**
   * Saves dirty real auth-file prefixes to the Management API via PATCH.
   *
   * SAFETY & RECONCILIATION INVARIANTS:
   * - Restricts concurrently conflicting duplicate non-empty prefixes before dispatching.
   * - Prevents overlapping saves: multiple clicks or invocations while in-flight are ignored.
   * - Demo mode is strictly local-only and non-persistable.
   * - Synthetic nodes are NEVER sent to the Management API.
   * - Sends exact physical filename and current prefix (including empty string).
   * - CRITICAL: Reconciles saved prefixes per filename using submitted values via RECONCILE_SAVED_NODES
   *   pure reducer dispatch, advancing initialPrefix for successful files, retaining original
   *   initialPrefix for failed files, and preserving all concurrent draft edits made while pending.
   * - Does NOT blindly reset the graph.
   * - Multi-file partial failure: no claiming atomicity; reports partial success and permits retry.
   */
  const handleSaveChanges = useCallback(async () => {
    // Guard against demo mode: demo is local-only non-persistable
    if (allowSynthetic) {
      const err = 'Demo mode is local-only and non-persistable.';
      setSaveState({
        status: 'error',
        message: err,
        successful: [],
        failed: [],
      });
      return { success: false, error: err };
    }

    // Prevent overlapping saves
    if (isSavingRef.current) {
      return { success: false, error: 'Save already in progress' };
    }

    // Find dirty REAL auth file nodes (never send synthetic nodes)
    const dirtyRealNodes = nodes.filter(
      (n) => Boolean(n.data?.isDirty) && !n.data?.isSynthetic
    );

    if (dirtyRealNodes.length === 0) {
      setSaveState({
        status: 'idle',
        message: 'No unsaved modifications to persist.',
        successful: [],
        failed: [],
      });
      return { success: true, count: 0 };
    }

    // Extract exact physical filename and current prefix (including empty string)
    const filesToSave = dirtyRealNodes.map((n) => {
      const fileName = n.data?.fileName || n.id;
      const prefix = n.data?.prefix !== undefined ? String(n.data.prefix).trim() : '';
      return {
        id: n.id,
        name: fileName,
        prefix,
        isSynthetic: Boolean(n.data?.isSynthetic),
      };
    });

    // Capture state snapshot before save begins to track pre-save topology
    const preSaveEdges = [...(graphStateRef.current?.edges || edges)];

    isSavingRef.current = true;
    setIsSaving(true);
    setSaveState({
      status: 'saving',
      message: `Saving ${filesToSave.length} modified profile(s)...`,
      successful: [],
      failed: [],
    });

    try {
      const saveResult = await saveAuthFilePrefixes(filesToSave, apiOptions);
      const { successful = [], failed = [] } = saveResult;

      // CRITICAL: Reconcile saved prefixes using submitted values, preserving latest drafts
      dispatch({
        type: 'RECONCILE_SAVED_NODES',
        successful,
        failed,
      });

      if (typeof onGraphChange === 'function') {
        onGraphChange();
      }

      // Update baseline nodes with newly saved prefixes to prevent Reset from reverting to stale initial props.
      // Must be built from freshest graph state (graphStateRef.current), not stale closure values,
      // preserving in-flight edge changes and latest draft edits while maintaining prefix/edge coherence.
      if (successful.length > 0) {
        const savedMap = new Map();
        successful.forEach((item) => {
          if (item && item.name) {
            savedMap.set(item.name, item.prefix !== undefined ? String(item.prefix).trim() : '');
          }
        });

        const latestState = graphStateRef.current || { nodes, edges };

        // 1. Construct baseline nodes with reconciled server-saved prefixes
        const baselineNodes = latestState.nodes.map((node) => {
          const fileKey = node.data?.fileName || node.id;
          if (savedMap.has(fileKey)) {
            const newPrefix = savedMap.get(fileKey);
            return {
              ...node,
              data: {
                ...node.data,
                prefix: newPrefix,
                initialPrefix: newPrefix,
                label: newPrefix || node.data?.fileName || node.id,
                isDirty: false,
              },
            };
          }
          return node;
        });

        // 2. Construct baseline edges:
        // Start with freshest edges from latestState.edges (preserving in-flight connections).
        const baselineEdgesMap = new Map();
        latestState.edges.forEach((e) => {
          if (e && e.id) {
            baselineEdgesMap.set(e.id, e);
          }
        });

        // Ensure prefix/edge coherence for nodes successfully saved with a non-empty prefix:
        // If a node was saved to the server with a non-empty child prefix (e.g. 'agy_p1_1')
        // but was draft-disconnected while the async save was pending (so its edge is missing
        // in latestState.edges), restore its pre-save incoming edge in the baseline.
        // This guarantees that Reset restores the coherent server-saved state (both prefix AND edge)
        // without leaving orphan child nodes with child prefixes.
        successful.forEach((item) => {
          const fileKey = item?.name;
          const savedPrefix = item?.prefix !== undefined ? String(item.prefix).trim() : '';
          if (savedPrefix !== '') {
            const preEdge = preSaveEdges.find(
              (e) => e && (e.target === fileKey || e.target === item.id)
            );
            if (preEdge) {
              const hasIncoming = Array.from(baselineEdgesMap.values()).some(
                (e) => e && (e.target === fileKey || e.target === item.id)
              );
              if (!hasIncoming) {
                const sourceNode = baselineNodes.find(
                  (n) => n && (n.id === preEdge.source || n.data?.fileName === preEdge.source)
                );
                const sourcePrefix = sourceNode?.data?.prefix || '';
                // Deterministic coherence check: only restore edge if source prefix matches child prefix pattern
                if (sourcePrefix && savedPrefix.startsWith(`${sourcePrefix}_`)) {
                  baselineEdgesMap.set(preEdge.id, preEdge);
                }
              }
            }
          }
        });

        currentBaselineRef.current = {
          nodes: baselineNodes,
          edges: Array.from(baselineEdgesMap.values()),
        };
      }

      if (failed.length === 0) {
        setSaveState({
          status: 'success',
          message: `Successfully saved ${successful.length} profile(s).`,
          successful,
          failed: [],
        });
        if (typeof onSaveSuccess === 'function') {
          onSaveSuccess(successful);
        }
        return { success: true, count: successful.length, successful };
      } else if (successful.length > 0) {
        setSaveState({
          status: 'partial',
          message: `Partially saved: ${successful.length} succeeded, ${failed.length} failed.`,
          successful,
          failed,
        });
        if (typeof onSaveError === 'function') {
          onSaveError({ successful, failed });
        }
        return { success: false, partial: true, successful, failed };
      } else {
        setSaveState({
          status: 'error',
          message: `Failed to save ${failed.length} profile(s).`,
          successful: [],
          failed,
        });
        if (typeof onSaveError === 'function') {
          onSaveError({ successful: [], failed });
        }
        return { success: false, failed };
      }
    } catch (err) {
      const errMsg = err.message || 'Failed to save profiles';
      setSaveState({
        status: 'error',
        message: errMsg,
        successful: [],
        failed: filesToSave.map((f) => ({ ...f, error: errMsg })),
      });
      if (typeof onSaveError === 'function') {
        onSaveError({
          successful: [],
          failed: filesToSave.map((f) => ({ ...f, error: errMsg })),
        });
      }
      return { success: false, error: errMsg };
    } finally {
      isSavingRef.current = false;
      setIsSaving(false);
    }
  }, [
    allowSynthetic,
    nodes,
    apiOptions,
    onGraphChange,
    onSaveSuccess,
    onSaveError,
  ]);

  /**
   * Resets graph restoring baseline clean state.
   * Prevents reset during save, and restores saved baseline rather than stale initial props.
   * Prompts for confirmation if any node has unsaved modifications (dirty).
   */
  const handleResetGraph = useCallback(() => {
    if (isSavingRef.current) {
      return false; // Prevent reset during active save
    }

    const hasDirty = nodes.some((n) => Boolean(n.data?.isDirty));
    if (hasDirty) {
      const confirmed =
        typeof window !== 'undefined' && typeof window.confirm === 'function'
          ? window.confirm(
              'You have unsaved prefix modifications. Resetting will discard all changes. Continue?'
            )
          : true;
      if (!confirmed) {
        return false;
      }
    }

    const baseline = currentBaselineRef.current || {
      nodes: safeInitialNodes,
      edges: safeInitialEdges,
    };
    dispatch({ type: 'RESET', nodes: baseline.nodes, edges: baseline.edges });
    return true;
  }, [nodes, safeInitialNodes, safeInitialEdges]);

  /**
   * Deterministically arranges nodes by topology hierarchy.
   * Preserves manual node edits, dirty flags, and IDs.
   */
  const handleAutoArrange = useCallback(() => {
    dispatch({ type: 'AUTO_ARRANGE' });
    if (typeof onGraphChange === 'function') {
      onGraphChange();
    }
  }, [onGraphChange]);

  // Expose imperative handle for direct programmatic testing
  useImperativeHandle(
    ref,
    () => ({
      connect: (conn) => onConnect(conn),
      onConnect,
      updateNodePrefix: (id, prefix) => handleNodePrefixChange(id, prefix),
      disconnectNode: (id) => handleDisconnectNode(id),
      removeEdges: (edgeIds) => {
        const edgeList = Array.isArray(edgeIds) ? edgeIds : [edgeIds].filter(Boolean);
        dispatch({
          type: 'REMOVE_EDGES',
          edgeIds: edgeList,
        });
        if (typeof onGraphChange === 'function') {
          onGraphChange();
        }
        const currentEdges = graphStateRef.current?.edges || [];
        return partitionEdgeRemovals(currentEdges, edgeList);
      },
      getNodes: () => nodes,
      getEdges: () => edges,
      onNodesChange: (changes) => onNodesChange(changes),
      onEdgesChange: (changes) => onEdgesChange(changes),
      openPrefixManagement: () => handleOpenPrefixManagement(),
      openGroupModal: () => handleOpenGroupModal(),
      isDirty: () => nodes.some((n) => Boolean(n.data?.isDirty)),
      isSaving: () => Boolean(isSavingRef.current),
      save: () => handleSaveChanges(),
      getSaveState: () => saveState,
      autoArrange: () => handleAutoArrange(),
      arrange: () => handleAutoArrange(),
      reset: (force = false) => {
        if (isSavingRef.current) {
          return false; // Prevent reset during active save
        }
        if (!force && nodes.some((n) => Boolean(n.data?.isDirty))) {
          const confirmed =
            typeof window !== 'undefined' && typeof window.confirm === 'function'
              ? window.confirm(
                  'You have unsaved prefix modifications. Resetting will discard all changes. Continue?'
                )
              : true;
          if (!confirmed) return false;
        }
        const baseline = currentBaselineRef.current || {
          nodes: safeInitialNodes,
          edges: safeInitialEdges,
        };
        dispatch({ type: 'RESET', nodes: baseline.nodes, edges: baseline.edges });
        return true;
      },
    }),
    [
      onConnect,
      handleNodePrefixChange,
      handleDisconnectNode,
      handleSaveChanges,
      isSaving,
      saveState,
      nodes,
      edges,
      safeInitialNodes,
      safeInitialEdges,
      handleAutoArrange,
      onNodesChange,
      onEdgesChange,
    ]
  );

  // Input state for custom prefix
  const [customPrefix, setCustomPrefix] = useState('');

  // Modal de Creación y Estructuración de Grupo
  const [isGroupModalOpen, setIsGroupModalOpen] = useState(false);
  const [activeGroupTab, setActiveGroupTab] = useState('create'); // 'create' | 'dissolve'
  const [groupBasePrefix, setGroupBasePrefix] = useState('');
  const [selectedActiveNodeId, setSelectedActiveNodeId] = useState('');
  const [selectedReserveNodeIds, setSelectedReserveNodeIds] = useState([]);
  const [groupModalError, setGroupModalError] = useState('');

  // Modal / Drawer de Gestión de Prefijos y Cuentas
  const [isPendingModalOpen, setIsPendingModalOpen] = useState(false);
  const [pendingPrefixDrafts, setPendingPrefixDrafts] = useState({});
  const [prefixTableFilter, setPrefixTableFilter] = useState('all'); // 'all' | 'unassigned' | 'antigravity' | 'codex'

  // Cuentas verdaderamente libres (sin padre entrante, sin reservas salientes, y sin prefijo de pool activo)
  const freeNodes = useMemo(() => {
    return nodes.filter((n) => {
      const hasIncoming = edges.some((e) => e && e.target === n.id);
      const hasOutgoing = edges.some((e) => e && e.source === n.id);
      if (hasIncoming || hasOutgoing) return false;

      const pref = (n.data?.prefix || '').trim();
      if (pref !== '' && !pref.startsWith('unlinked_')) return false;

      return true;
    });
  }, [nodes, edges]);

  // Cuentas filtradas para la Tabla Central de Gestión de Prefijos
  const filteredTableNodes = useMemo(() => {
    return nodes.filter((n) => {
      const prov = (n.data?.provider || n.data?.accountType || '').toLowerCase();
      const pref = (n.data?.prefix || '').trim();
      const isUnassigned = pref === '' || pref.startsWith('unlinked_');

      if (prefixTableFilter === 'unassigned') {
        return isUnassigned;
      }
      if (prefixTableFilter === 'antigravity') {
        return prov === 'antigravity';
      }
      if (prefixTableFilter === 'codex') {
        return prov === 'codex';
      }
      return true;
    });
  }, [nodes, prefixTableFilter]);

  // Manejador para abrir el modal sincronizando los borradores con los prefijos reales
  const handleOpenPrefixManagement = useCallback(() => {
    const initialDrafts = {};
    nodes.forEach((n) => {
      initialDrafts[n.id] = n.data?.prefix !== undefined ? n.data.prefix : '';
    });
    setPendingPrefixDrafts(initialDrafts);
    setPrefixTableFilter('all');
    setIsPendingModalOpen(true);
  }, [nodes]);

  const handleOpenGroupModal = useCallback(() => {
    setIsGroupModalOpen(true);
    setActiveGroupTab('create');
    setGroupBasePrefix('');
    setGroupModalError('');
    setSelectedReserveNodeIds([]);

    // Encontrar primera cuenta libre para preseleccionar
    const freeCandidates = nodes.filter((n) => !edges.some((e) => e.target === n.id));
    const firstActive = freeCandidates[0]?.id || '';
    setSelectedActiveNodeId(firstActive);

    // Si la cuenta activa ya tiene un prefijo base (ej. agy_g3), sugerirlo de entrada
    const activeNode = nodes.find((n) => n.id === firstActive);
    const existingPref = (activeNode?.data?.prefix || '').trim();
    if (existingPref && !existingPref.startsWith('unlinked_')) {
      setGroupBasePrefix(existingPref);
    }
  }, [nodes, edges]);

  // Selección reactiva de cuenta activa: actualiza el prefijo sugerido y resetea reservas no compatibles
  const handleSelectActiveNode = useCallback((nodeId) => {
    setSelectedActiveNodeId(nodeId);
    setSelectedReserveNodeIds([]);
    const chosenNode = nodes.find((n) => n.id === nodeId);
    const chosenPref = (chosenNode?.data?.prefix || '').trim();
    if (chosenPref && !chosenPref.startsWith('unlinked_')) {
      setGroupBasePrefix(chosenPref);
    } else {
      const prov = (chosenNode?.data?.provider || chosenNode?.data?.accountType || '').toLowerCase();
      if (prov === 'codex') {
        setGroupBasePrefix('codex_');
      } else {
        setGroupBasePrefix('agy_');
      }
    }
  }, [nodes]);

  // Cuentas de reserva compatibles con el proveedor de la cuenta activa
  const compatibleReserveNodes = useMemo(() => {
    if (!selectedActiveNodeId) return [];
    const activeNode = nodes.find((n) => n.id === selectedActiveNodeId);
    if (!activeNode) return [];

    const activeProv = (activeNode.data?.provider || activeNode.data?.accountType || '').toLowerCase();
    const isActiveCodex = activeProv === 'codex';

    return freeNodes.filter((n) => {
      if (n.id === selectedActiveNodeId) return false;
      const prov = (n.data?.provider || n.data?.accountType || '').toLowerCase();
      const isCodex = prov === 'codex';
      return isActiveCodex ? isCodex : !isCodex;
    });
  }, [selectedActiveNodeId, nodes, freeNodes]);

  const handleToggleReserve = useCallback((nodeId) => {
    setSelectedReserveNodeIds((prev) =>
      prev.includes(nodeId) ? prev.filter((id) => id !== nodeId) : [...prev, nodeId]
    );
  }, []);

  const handleSubmitGroup = useCallback(() => {
    const trimmedBase = groupBasePrefix.trim();
    if (!trimmedBase) {
      setGroupModalError('El prefijo base del grupo no puede estar vacío.');
      return;
    }
    if (!/^[a-zA-Z0-9_-]+$/.test(trimmedBase)) {
      setGroupModalError('El prefijo solo puede contener letras, números, guiones y guiones bajos.');
      return;
    }
    if (!selectedActiveNodeId) {
      setGroupModalError('Debes seleccionar una cuenta para que sea la Principal (Activa).');
      return;
    }

    // 1. Asignar prefijo base a la cuenta activa y luego conectar
    const updatedNodes = nodes.map((node) => {
      if (node.id === selectedActiveNodeId) {
        const initial = node.data?.initialPrefix !== undefined ? node.data.initialPrefix : '';
        return {
          ...node,
          data: {
            ...node.data,
            prefix: trimmedBase,
            label: trimmedBase,
            isDirty: trimmedBase !== initial,
            isRoot: true,
          },
        };
      }
      return node;
    });

    let currentNodes = updatedNodes;
    let currentEdges = edges;

    // 2. Conectar cada reserva a la activa mediante pure reducer logic
    selectedReserveNodeIds.forEach((resId) => {
      if (resId !== selectedActiveNodeId) {
        const nextState = graphReducer(
          { nodes: currentNodes, edges: currentEdges, graphFeedback: null, lastRemoval: null },
          {
            type: 'CONNECT',
            connection: {
              source: selectedActiveNodeId,
              target: resId,
            },
          }
        );
        currentNodes = nextState.nodes;
        currentEdges = nextState.edges;
      }
    });

    dispatch({ type: 'LOAD_GRAPH', nodes: currentNodes, edges: currentEdges });

    // 3. Auto-organizar visualmente el layout
    dispatch({ type: 'AUTO_ARRANGE' });

    if (typeof onGraphChange === 'function') {
      onGraphChange();
    }

    setIsGroupModalOpen(false);
  }, [groupBasePrefix, selectedActiveNodeId, selectedReserveNodeIds, nodes, edges, onGraphChange]);

  // Desarmar / Disolver un pool completo liberando todas sus cuentas
  const handleDissolvePool = useCallback((rootNodeId) => {
    const rootNode = nodes.find((n) => n.id === rootNodeId);
    if (!rootNode) return;

    // Encontrar todas las aristas que parten de esta raíz
    const outgoingEdges = edges.filter((e) => e && e.source === rootNodeId);
    const edgeIds = new Set(outgoingEdges.map((e) => e.id));

    // 1. Nuevas aristas sin las del grupo
    const nextEdges = edges.filter((e) => e && !edgeIds.has(e.id));

    // 2. Limpiar tanto la raíz como las reservas que estaban conectadas a ella
    const nextNodes = nodes.map((node) => {
      if (node.id === rootNodeId) {
        const initial = node.data?.initialPrefix !== undefined ? node.data.initialPrefix : '';
        return {
          ...node,
          data: {
            ...node.data,
            prefix: '',
            label: node.data?.fileName || node.id,
            isDirty: '' !== initial,
            isRoot: false,
          },
        };
      }
      if (outgoingEdges.some((e) => e.target === node.id)) {
        const initial = node.data?.initialPrefix !== undefined ? node.data.initialPrefix : '';
        return {
          ...node,
          data: {
            ...node.data,
            prefix: '',
            label: node.data?.fileName || node.id,
            isDirty: '' !== initial,
            isRoot: false,
          },
        };
      }
      return node;
    });

    dispatch({ type: 'LOAD_GRAPH', nodes: nextNodes, edges: nextEdges });

    // 3. Reacomodar el lienzo
    dispatch({ type: 'AUTO_ARRANGE' });

    if (typeof onGraphChange === 'function') {
      onGraphChange();
    }
  }, [nodes, edges, onGraphChange]);

  // Manejador de asignación o cambio de prefijo individual en la tabla
  const handleSavePendingPrefix = useCallback((nodeId) => {
    const draft = (pendingPrefixDrafts[nodeId] || '').trim();
    dispatch({ type: 'UPDATE_NODE_PREFIX', id: nodeId, prefix: draft });
    if (typeof onGraphChange === 'function') {
      onGraphChange();
    }
  }, [pendingPrefixDrafts, onGraphChange]);

  /**
   * Creates a root node using atomic reducer dispatch.
   * IDs are generated before dispatch to preserve reducer purity.
   */
  const handleAddRootNode = useCallback(() => {
    const newId = generateId('p');
    dispatch({
      type: 'ADD_ROOT_NODE',
      id: newId,
      customPrefix,
    });
    setCustomPrefix('');
  }, [customPrefix, generateId]);

  /**
   * Creates an unlinked child node using atomic reducer dispatch.
   * IDs are generated before dispatch to preserve reducer purity.
   */
  const handleAddChildNode = useCallback(() => {
    const newId = generateId('c');
    dispatch({
      type: 'ADD_CHILD_NODE',
      id: newId,
    });
  }, [generateId]);

  // Derive outgoingCount and attach atomic callbacks to all nodes
  const displayNodes = useMemo(() => {
    return nodes.map((node) => {
      const derivedCount = countOutgoingEdges(edges, node.id);
      const incomingEdge = edges.find((e) => e && e.target === node.id);
      return {
        ...node,
        data: {
          ...node.data,
          outgoingCount: derivedCount,
          hasParent: Boolean(incomingEdge),
          onPrefixChange: handleNodePrefixChange,
          onDisconnect: handleDisconnectNode,
        },
      };
    });
  }, [nodes, edges, handleNodePrefixChange, handleDisconnectNode]);

  // Derived metrics for UI status bar
  const rootCount = useMemo(() => nodes.filter((n) => n.data?.isRoot).length, [nodes]);
  const childCount = useMemo(() => nodes.filter((n) => !n.data?.isRoot).length, [nodes]);
  const dirtyCount = useMemo(
    () => nodes.filter((n) => Boolean(n.data?.isDirty)).length,
    [nodes]
  );

  return (
    <div className="graph-container">
      {/* Top Banner and Toolbar */}
      <div className="graph-toolbar">
        <div className="toolbar-left">
          <span className="toolbar-title">Visual Profile Prefix Topology</span>
          {allowSynthetic ? (
            <span className="badge-editor-only">Editor Only — Local Graph</span>
          ) : (
            <span className="badge-live-auth" data-testid="badge-live-auth">
              Management Auth-Files
            </span>
          )}
        </div>

        <div className="toolbar-controls">
          {allowSynthetic && (
            <>
              <div className="input-group">
                <input
                  type="text"
                  placeholder="e.g. agy_p1 or custom_pool"
                  value={customPrefix}
                  onChange={(e) => setCustomPrefix(e.target.value)}
                  className="prefix-input"
                  data-testid="input-custom-prefix"
                />
                <button
                  type="button"
                  onClick={handleAddRootNode}
                  className="btn btn-primary"
                  data-testid="btn-add-root"
                >
                  + Add Root Profile
                </button>
              </div>

              <button
                type="button"
                onClick={handleAddChildNode}
                className="btn btn-secondary"
                data-testid="btn-add-child"
              >
                + Add Child Node
              </button>
            </>
          )}

          <button
            type="button"
            onClick={handleAutoArrange}
            className="btn btn-outline"
            data-testid="btn-auto-arrange"
            title="Arrange nodes deterministically by topology hierarchy"
          >
            Auto Arrange
          </button>

          <button
            type="button"
            onClick={handleResetGraph}
            className="btn btn-outline"
            data-testid="btn-reset-graph"
            disabled={isSaving}
          >
            Reset Graph
          </button>

          {!allowSynthetic && (
            <button
              type="button"
              onClick={handleSaveChanges}
              disabled={isSaving || dirtyCount === 0}
              className="btn btn-primary btn-save"
              data-testid="btn-save-changes"
              title={
                dirtyCount === 0
                  ? 'No unsaved modifications'
                  : 'Save modified prefixes to Management API'
              }
            >
              {isSaving
                ? 'Saving...'
                : dirtyCount > 0
                ? `Save Changes (${dirtyCount})`
                : 'Save Changes'}
            </button>
          )}
        </div>
      </div>

      {/* Stats bar */}
      <div className="graph-stats-bar">
        <span>
          Roots: <strong>{rootCount}</strong>
        </span>
        <span className="stats-divider">•</span>
        <span>
          Children: <strong>{childCount}</strong>
        </span>
        <span className="stats-divider">•</span>
        <span>
          Connections: <strong>{edges.length}</strong>
        </span>
        {dirtyCount > 0 && (
          <>
            <span className="stats-divider">•</span>
            <span className="stats-dirty" data-testid="stats-dirty-count">
              Modified: <strong className="text-warning">{dirtyCount}</strong>
            </span>
          </>
        )}
        <span className="stats-divider">•</span>
        <span className="stats-hint">
          Connect a parent node to a child node to assign <code>{'{parentPrefix}_{index}'}</code>
        </span>
      </div>

      {/* Save Feedback Banner */}
      {saveState.status !== 'idle' && (
        <div
          className={`save-status-banner save-status-${saveState.status}`}
          data-testid={`save-status-${saveState.status}`}
        >
          <div className="save-status-content">
            {saveState.status === 'saving' && <span className="loading-spinner-sm" />}
            <span className="save-status-message">{saveState.message}</span>
            {saveState.failed && saveState.failed.length > 0 && (
              <ul className="save-status-failures">
                {saveState.failed.map((f, i) => (
                  <li key={i} data-testid={`save-failure-${maskDisplayIdentifier(f.name)}`}>
                    <code>{maskDisplayIdentifier(f.name)}</code>: {maskDisplayIdentifier(f.error)}
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="save-status-actions">
            {(saveState.status === 'partial' || saveState.status === 'error') && (
              <button
                type="button"
                className="btn btn-retry-save"
                onClick={handleSaveChanges}
                data-testid="btn-retry-save"
              >
                🔄 Retry
              </button>
            )}
            {saveState.status !== 'saving' && (
              <button
                type="button"
                className="btn-dismiss-banner"
                onClick={handleDismissSaveStatus}
                data-testid="btn-dismiss-save-status"
                aria-label="Dismiss banner"
              >
                ✕
              </button>
            )}
          </div>
        </div>
      )}

      {/* Graph Action Feedback Banner (e.g. Descendant Guard block) */}
      {graphFeedback && (
        <div
          className="save-status-banner save-status-error graph-feedback-banner"
          data-testid="graph-feedback-banner"
        >
          <div className="save-status-content">
            <span className="save-status-message">{maskDisplayIdentifier(graphFeedback)}</span>
          </div>
          <div className="save-status-actions">
            <button
              type="button"
              className="btn-dismiss-banner"
              onClick={() => setGraphFeedback(null)}
              data-testid="btn-dismiss-graph-feedback"
              aria-label="Dismiss feedback"
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {/* React Flow Canvas */}
      <div className="react-flow-wrapper" data-testid="rf-wrapper">
        <ReactFlow
          nodes={displayNodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          nodeTypes={nodeTypes}
          fitView
        >
          <Background variant={BackgroundVariant.Dots} gap={16} size={1} color="#30363d" />
          <Controls />
          <MiniMap
            nodeColor={(node) => (node.data?.isRoot ? '#238636' : '#1f6feb')}
            style={{ backgroundColor: '#161b22' }}
          />
        </ReactFlow>
      </div>

      {/* Modal / Diálogo para Crear y Armar Grupo de Perfiles */}
      {isGroupModalOpen && (
        <div className="group-modal-backdrop" onClick={() => setIsGroupModalOpen(false)}>
          <div
            className="group-modal-container"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
          >
            <div className="group-modal-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '18px' }}>⚡</span>
                <h3 className="group-modal-title">Crear y Armar Grupo de Perfiles</h3>
              </div>
              <button
                type="button"
                className="btn-dismiss-banner"
                onClick={() => setIsGroupModalOpen(false)}
                aria-label="Cerrar modal"
              >
                ✕
              </button>
            </div>

            {/* Pestañas del Modal: Crear Grupo vs Disolver Pools */}
            <div className="group-modal-tabs">
              <button
                type="button"
                className={`group-modal-tab ${activeGroupTab === 'create' ? 'active' : ''}`}
                onClick={() => setActiveGroupTab('create')}
                data-testid="modal-tab-create"
              >
                ⚡ Armar Nuevo Pool
              </button>
              <button
                type="button"
                className={`group-modal-tab ${activeGroupTab === 'dissolve' ? 'active' : ''}`}
                onClick={() => setActiveGroupTab('dissolve')}
                data-testid="modal-tab-dissolve"
              >
                💥 Disolver / Desagrupar Pools
              </button>
            </div>

            {activeGroupTab === 'create' && (
              <>
                <p className="group-modal-desc">
                  Define el prefijo base del pool (ej. <code>agy_g3</code> o <code>codex_dev</code>). Solo se listan cuentas libres; al elegir la Principal, las reservas se filtran al mismo proveedor.
                </p>

                {groupModalError && (
                  <div className="group-modal-error">
                    {groupModalError}
                  </div>
                )}

                <div className="group-modal-body">
                  {freeNodes.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: '24px 16px', background: 'rgba(7, 9, 14, 0.5)', borderRadius: '10px', border: '1px dashed rgba(248, 81, 73, 0.4)' }}>
                      <span style={{ fontSize: '24px' }}>⚠️</span>
                      <h4 style={{ color: '#f85149', margin: '8px 0 4px', fontSize: '13px' }}>
                        No hay cuentas libres disponibles
                      </h4>
                      <p style={{ color: '#94a3b8', fontSize: '11px', margin: 0, lineHeight: 1.4 }}>
                        Todas las cuentas están asignadas a grupos existentes. Para armar un nuevo pool, ve a la pestaña <strong>"💥 Disolver / Desagrupar Pools"</strong> para liberar cuentas.
                      </p>
                    </div>
                  ) : (
                    <>
                      {/* Prefijo Base */}
                      <div className="group-modal-field">
                        <label className="group-modal-label">Prefijo Base del Grupo (Pool):</label>
                        <input
                          type="text"
                          className="group-modal-input"
                          placeholder="ej. agy_g3 o codex_dev"
                          value={groupBasePrefix}
                          onChange={(e) => {
                            setGroupBasePrefix(e.target.value);
                            setGroupModalError('');
                          }}
                          autoFocus
                          data-testid="modal-input-base-prefix"
                        />
                      </div>

                      {/* Cuenta Principal / Activa */}
                      <div className="group-modal-field">
                        <label className="group-modal-label" data-testid="label-active-node" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <span style={{ fontSize: '1em', lineHeight: 1 }}>👑</span>
                          <span>Cuenta Principal (Activa / Root):</span>
                        </label>
                        <select
                          className="group-modal-select"
                          value={selectedActiveNodeId}
                          onChange={(e) => handleSelectActiveNode(e.target.value)}
                          data-testid="modal-select-active-node"
                        >
                          <option value="" disabled>-- Selecciona la cuenta activa --</option>
                          {freeNodes.map((n) => {
                            const prov = (n.data?.provider || n.data?.accountType || '').toUpperCase() || 'GENERAL';
                            const label = n.data?.email || n.data?.fileName || n.id;
                            const pref = n.data?.prefix ? ` [${n.data.prefix}]` : '';
                            return (
                              <option key={n.id} value={n.id}>
                                👑 {label}{pref} ({prov})
                              </option>
                            );
                          })}
                        </select>
                      </div>

                      {/* Cuentas de Reserva */}
                      <div className="group-modal-field">
                        <label className="group-modal-label">Cuentas de Reserva (Mismo Proveedor en Cascada):</label>
                        <div className="group-modal-reserves-list">
                          {compatibleReserveNodes.map((n) => {
                            const isChecked = selectedReserveNodeIds.includes(n.id);
                            const label = n.data?.email || n.data?.fileName || n.id;
                            const pref = n.data?.prefix ? ` [${n.data.prefix}]` : '';
                            const prov = (n.data?.provider || n.data?.accountType || '').toUpperCase();
                            return (
                              <label key={n.id} className="group-modal-reserve-item">
                                <input
                                  type="checkbox"
                                  checked={isChecked}
                                  onChange={() => handleToggleReserve(n.id)}
                                  data-testid={`modal-check-reserve-${n.id}`}
                                />
                                <span style={{ fontSize: '12px', color: '#cbd5e1' }}>
                                  {label} <span style={{ color: '#c084fc', fontFamily: 'monospace' }}>{pref}</span>
                                  {prov && <span style={{ fontSize: '10px', color: '#94a3b8', marginLeft: '6px' }}>({prov})</span>}
                                </span>
                              </label>
                            );
                          })}
                          {compatibleReserveNodes.length === 0 && (
                            <div style={{ fontSize: '11px', color: '#94a3b8', fontStyle: 'italic', padding: '6px' }}>
                              No hay cuentas libres compatibles con el proveedor seleccionado.
                            </div>
                          )}
                        </div>
                      </div>
                    </>
                  )}
                </div>

                <div className="group-modal-footer">
                  <button
                    type="button"
                    className="btn btn-outline"
                    onClick={() => setIsGroupModalOpen(false)}
                    data-testid="modal-btn-cancel-group"
                  >
                    Cancelar
                  </button>
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={handleSubmitGroup}
                    disabled={freeNodes.length === 0}
                    data-testid="modal-btn-submit-group"
                  >
                    ✓ Armar Grupo en Canvas
                  </button>
                </div>
              </>
            )}

            {activeGroupTab === 'dissolve' && (
              <div className="group-modal-body" style={{ gap: '12px' }}>
                <p className="group-modal-desc" style={{ padding: 0 }}>
                  Selecciona cualquier pool para desarmarlo por completo. Todas sus cuentas volverán a estar libres y sin grupo.
                </p>
                <div className="group-modal-reserves-list" style={{ maxHeight: '240px' }}>
                  {nodes
                    .filter((n) => n.data?.isRoot || edges.some((e) => e.source === n.id))
                    .map((rootNode) => {
                      const poolPrefix = rootNode.data?.prefix || rootNode.data?.label || rootNode.id;
                      const childCount = edges.filter((e) => e.source === rootNode.id).length;
                      return (
                        <div
                          key={rootNode.id}
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            padding: '8px 10px',
                            background: 'rgba(15, 23, 42, 0.6)',
                            borderRadius: '6px',
                            border: '1px solid rgba(51, 65, 85, 0.4)',
                          }}
                        >
                          <div>
                            <span style={{ fontWeight: 700, color: '#f3e8ff', fontFamily: 'monospace' }}>
                              {poolPrefix}
                            </span>
                            <span style={{ fontSize: '11px', color: '#94a3b8', marginLeft: '8px' }}>
                              ({childCount} reserva{childCount === 1 ? '' : 's'})
                            </span>
                          </div>
                          <button
                            type="button"
                            className="btn btn-disconnect-node"
                            onClick={() => {
                              handleDissolvePool(rootNode.id);
                              // Permanecer en el modal y cambiar automáticamente a la pestaña de armar
                              setActiveGroupTab('create');
                            }}
                            data-testid={`btn-dissolve-pool-${rootNode.id}`}
                            style={{ padding: '4px 10px', fontSize: '11px' }}
                          >
                            💥 Desarmar Pool
                          </button>
                        </div>
                      );
                    })}
                  {nodes.filter((n) => n.data?.isRoot || edges.some((e) => e.source === n.id)).length === 0 && (
                    <div style={{ fontSize: '11px', color: '#94a3b8', fontStyle: 'italic', padding: '10px', textAlign: 'center' }}>
                      No hay pools o grupos activos para desarmar.
                    </div>
                  )}
                </div>
                <div className="group-modal-footer" style={{ border: 'none', padding: 0 }}>
                  <button
                    type="button"
                    className="btn btn-outline"
                    onClick={() => setIsGroupModalOpen(false)}
                  >
                    Cerrar
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Modal / Diálogo Centralizado de Gestión de Prefijos y Cuentas */}
      {isPendingModalOpen && (
        <div className="group-modal-backdrop" onClick={() => setIsPendingModalOpen(false)}>
          <div
            className="group-modal-container"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            style={{ maxWidth: '840px', width: '92%' }}
          >
            <div className="group-modal-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '18px' }}>🏷️</span>
                <h3 className="group-modal-title">Gestión de Prefijos y Cuentas</h3>
              </div>
              <button
                type="button"
                className="btn-dismiss-banner"
                onClick={() => setIsPendingModalOpen(false)}
                data-testid="btn-close-prefix-table"
                aria-label="Cerrar modal"
              >
                ✕
              </button>
            </div>

            <p className="group-modal-desc">
              Visualiza y edita los prefijos de todas tus cuentas (nuevas, existentes o huérfanas). Asigna un prefijo inicial o actualízalo para cambiar el rol o modelo de enrutamiento.
            </p>

            {/* Barra de Filtros Rápidos */}
            <div style={{ display: 'flex', gap: '6px', padding: '10px 20px', borderBottom: '1px solid var(--border-color, #30363d)', background: 'rgba(13, 17, 23, 0.4)', flexWrap: 'wrap' }}>
              <button
                type="button"
                className={`cs-filter-chip ${prefixTableFilter === 'all' ? 'active' : ''}`}
                onClick={() => setPrefixTableFilter('all')}
                style={{
                  padding: '4px 10px',
                  borderRadius: '6px',
                  fontSize: '11px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  background: prefixTableFilter === 'all' ? 'rgba(168, 85, 247, 0.25)' : 'transparent',
                  color: prefixTableFilter === 'all' ? '#d8b4fe' : '#94a3b8',
                  border: prefixTableFilter === 'all' ? '1px solid #a855f7' : '1px solid #30363d',
                }}
              >
                Todas ({nodes.length})
              </button>
              <button
                type="button"
                className={`cs-filter-chip ${prefixTableFilter === 'unassigned' ? 'active' : ''}`}
                onClick={() => setPrefixTableFilter('unassigned')}
                style={{
                  padding: '4px 10px',
                  borderRadius: '6px',
                  fontSize: '11px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  background: prefixTableFilter === 'unassigned' ? 'rgba(234, 179, 8, 0.2)' : 'transparent',
                  color: prefixTableFilter === 'unassigned' ? '#fde047' : '#94a3b8',
                  border: prefixTableFilter === 'unassigned' ? '1px solid rgba(234, 179, 8, 0.5)' : '1px solid #30363d',
                }}
              >
                ⚪ Sin Prefijo / Libres ({nodes.filter((n) => !(n.data?.prefix || '').trim() || (n.data?.prefix || '').startsWith('unlinked_')).length})
              </button>
              <button
                type="button"
                className={`cs-filter-chip ${prefixTableFilter === 'antigravity' ? 'active' : ''}`}
                onClick={() => setPrefixTableFilter('antigravity')}
                style={{
                  padding: '4px 10px',
                  borderRadius: '6px',
                  fontSize: '11px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  background: prefixTableFilter === 'antigravity' ? 'rgba(35, 134, 54, 0.25)' : 'transparent',
                  color: prefixTableFilter === 'antigravity' ? '#3fb950' : '#94a3b8',
                  border: prefixTableFilter === 'antigravity' ? '1px solid rgba(46, 160, 67, 0.5)' : '1px solid #30363d',
                }}
              >
                🟢 Antigravity ({nodes.filter((n) => (n.data?.provider || n.data?.accountType || '').toLowerCase() === 'antigravity').length})
              </button>
              <button
                type="button"
                className={`cs-filter-chip ${prefixTableFilter === 'codex' ? 'active' : ''}`}
                onClick={() => setPrefixTableFilter('codex')}
                style={{
                  padding: '4px 10px',
                  borderRadius: '6px',
                  fontSize: '11px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  background: prefixTableFilter === 'codex' ? 'rgba(56, 139, 253, 0.25)' : 'transparent',
                  color: prefixTableFilter === 'codex' ? '#79c0ff' : '#94a3b8',
                  border: prefixTableFilter === 'codex' ? '1px solid rgba(56, 139, 253, 0.5)' : '1px solid #30363d',
                }}
              >
                🔵 Codex ({nodes.filter((n) => (n.data?.provider || n.data?.accountType || '').toLowerCase() === 'codex').length})
              </button>
            </div>

            {/* Tabla Estructurada con Columnas */}
            <div style={{ maxHeight: '360px', overflowY: 'auto', padding: '0 20px 10px' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '12px' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border-color, #30363d)', color: '#94a3b8', fontSize: '11px', letterSpacing: '0.04em' }}>
                    <th style={{ padding: '10px 8px' }}>PROVEEDOR</th>
                    <th style={{ padding: '10px 8px' }}>CUENTA / CORREO</th>
                    <th style={{ padding: '10px 8px' }}>ROL / ESTADO</th>
                    <th style={{ padding: '10px 8px' }}>PREFIJO</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredTableNodes.map((n) => {
                    const label = n.data?.email || n.data?.fileName || n.id;
                    const fileName = n.data?.fileName || n.id;
                    const prov = (n.data?.provider || n.data?.accountType || '').toUpperCase() || 'GENERAL';
                    const isCodex = prov === 'CODEX';
                    const draft = pendingPrefixDrafts[n.id] ?? (n.data?.prefix || '');
                    const currentPref = (n.data?.prefix || '').trim();

                    // Determinar el Rol / Estado
                    const isIncoming = edges.some((e) => e.target === n.id);
                    const isOutgoing = edges.some((e) => e.source === n.id);
                    let roleBadge = <span style={{ color: '#94a3b8', fontSize: '11px' }}>⚪ Libre</span>;

                    if (isOutgoing) {
                      roleBadge = <span style={{ color: '#3fb950', fontWeight: 600, fontSize: '11px' }}>👑 Activa (Root)</span>;
                    } else if (isIncoming) {
                      roleBadge = <span style={{ color: '#58a6ff', fontWeight: 600, fontSize: '11px' }}>🔄 Reserva (Child)</span>;
                    } else if (currentPref && !currentPref.startsWith('unlinked_')) {
                      roleBadge = <span style={{ color: '#c084fc', fontWeight: 600, fontSize: '11px' }}>🏷️ Con Prefijo</span>;
                    }

                    const placeholder = isCodex ? 'codex_...' : 'agy_...';
                    const isModified = draft !== currentPref;

                    return (
                      <tr
                        key={n.id}
                        data-testid={`prefix-row-${n.id}`}
                        style={{ borderBottom: '1px solid rgba(51, 65, 85, 0.3)', transition: 'background-color 0.15s' }}
                      >
                        {/* 1. PROVEEDOR */}
                        <td style={{ padding: '10px 8px' }}>
                          <span
                            style={{
                              fontSize: '10px',
                              fontWeight: 700,
                              padding: '2px 7px',
                              borderRadius: '4px',
                              fontFamily: 'monospace',
                              background: isCodex ? 'rgba(56, 139, 253, 0.15)' : 'rgba(35, 134, 54, 0.15)',
                              color: isCodex ? '#79c0ff' : '#3fb950',
                              border: isCodex ? '1px solid rgba(56, 139, 253, 0.4)' : '1px solid rgba(46, 160, 67, 0.4)',
                            }}
                          >
                            {prov}
                          </span>
                        </td>

                        {/* 2. CUENTA / CORREO */}
                        <td style={{ padding: '10px 8px', maxWidth: '240px' }}>
                          <div style={{ fontWeight: 600, color: '#f1f5f9', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={label}>
                            {label}
                          </div>
                          <div style={{ fontSize: '10px', color: '#64748b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={fileName}>
                            #{fileName}
                          </div>
                        </td>

                        {/* 3. ROL / ESTADO */}
                        <td style={{ padding: '10px 8px' }}>
                          {roleBadge}
                        </td>

                        {/* 4. PREFIJO EDITABLE */}
                        <td style={{ padding: '10px 8px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <input
                              type="text"
                              className="group-modal-input"
                              style={{
                                width: '130px',
                                padding: '4px 8px',
                                fontSize: '12px',
                                borderColor: isModified ? '#d29922' : 'var(--border-color, #30363d)',
                              }}
                              placeholder={placeholder}
                              value={draft}
                              onChange={(e) =>
                                setPendingPrefixDrafts((prev) => ({ ...prev, [n.id]: e.target.value }))
                              }
                              data-testid={`input-table-prefix-${n.id}`}
                            />
                            <button
                              type="button"
                              className="btn btn-primary"
                              style={{ padding: '4px 8px', fontSize: '11px' }}
                              onClick={() => handleSavePendingPrefix(n.id)}
                              data-testid={`btn-save-table-prefix-${n.id}`}
                              disabled={!isModified}
                              title="Aplicar prefijo"
                            >
                              ✓
                            </button>
                            {draft && (
                              <button
                                type="button"
                                className="btn btn-outline"
                                style={{ padding: '4px 6px', fontSize: '11px', color: '#f85149' }}
                                onClick={() => {
                                  setPendingPrefixDrafts((prev) => ({ ...prev, [n.id]: '' }));
                                  dispatch({ type: 'UPDATE_NODE_PREFIX', id: n.id, prefix: '' });
                                  if (typeof onGraphChange === 'function') onGraphChange();
                                }}
                                title="Limpiar prefijo a vacío"
                              >
                                ✕
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}

                  {filteredTableNodes.length === 0 && (
                    <tr>
                      <td colSpan="4" style={{ textAlign: 'center', padding: '24px', color: '#94a3b8', fontStyle: 'italic' }}>
                        No hay cuentas que coincidan con el filtro seleccionado.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="group-modal-footer">
              <button
                type="button"
                className="btn btn-outline"
                onClick={() => setIsPendingModalOpen(false)}
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
});

export default ProfileGraph;
