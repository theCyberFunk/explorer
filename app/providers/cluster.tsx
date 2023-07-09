'use client';

import { Connection, EpochInfo, EpochSchedule } from '@solana/web3.js';
import { Cluster, clusterName, ClusterStatus, clusterUrl, DEFAULT_CLUSTER } from '@utils/cluster';
import { localStorageIsAvailable } from '@utils/index';
import { reportError } from '@utils/sentry';
import { ReadonlyURLSearchParams, usePathname, useRouter, useSearchParams } from 'next/navigation';
import React, { createContext, useContext, useEffect, useReducer, useState } from 'react';

type Action = State;

interface ClusterInfo {
    firstAvailableBlock: number;
    epochSchedule: EpochSchedule;
    epochInfo: EpochInfo;
}

type Dispatch = (action: Action) => void;

type SetShowModal = React.Dispatch<React.SetStateAction<boolean>>;

interface State {
    cluster: Cluster;
    customUrl: string;
    clusterInfo?: ClusterInfo;
    status: ClusterStatus;
}

const DEFAULT_CUSTOM_URL = 'http://localhost:8899';

function clusterReducer(state: State, action: Action): State {
    switch (action.status) {
        case ClusterStatus.Connected:
        case ClusterStatus.Failure: {
            if (state.cluster !== action.cluster || state.customUrl !== action.customUrl) return state;
            return action;
        }
        case ClusterStatus.Connecting: {
            return action;
        }
    }
}

function parseQuery(searchParams: ReadonlyURLSearchParams | null): Cluster {
    const clusterParam = searchParams?.get('cluster');
    switch (clusterParam) {
        case 'custom':
            return Cluster.Custom;
        case 'devnet':
            return Cluster.Devnet;
        case 'testnet':
            return Cluster.Testnet;
        case 'mainnet-beta':
        default:
            return Cluster.MainnetBeta;
    }
}

const ModalContext = createContext<[boolean, SetShowModal] | undefined>(undefined);
const StateContext = createContext<State | undefined>(undefined);
const DispatchContext = createContext<Dispatch | undefined>(undefined);

type ClusterProviderProps = { children: React.ReactNode };
export function ClusterProvider({ children }: ClusterProviderProps) {
    const [state, dispatch] = useReducer(clusterReducer, {
        cluster: DEFAULT_CLUSTER,
        customUrl: DEFAULT_CUSTOM_URL,
        status: ClusterStatus.Connecting,
    });
    const modalState = useState(false);
    const searchParams = useSearchParams();
    const cluster = parseQuery(searchParams);
    const enableCustomUrl = localStorageIsAvailable() && localStorage.getItem('enableCustomUrl') !== null;
    const customUrl = (enableCustomUrl && searchParams?.get('customUrl')) || state.customUrl;
    const pathname = usePathname();
    const router = useRouter();

    // Remove customUrl param if dev setting is disabled
    useEffect(() => {
        if (!enableCustomUrl && searchParams?.has('customUrl')) {
            const newSearchParams = new URLSearchParams();
            searchParams.forEach((value, key) => {
                if (key === 'customUrl') {
                    return;
                }
                newSearchParams.set(key, value);
            });
            const nextQueryString = newSearchParams.toString();
            router.push(`${pathname}${nextQueryString ? `?${nextQueryString}` : ''}`);
        }
    }, [enableCustomUrl]); // eslint-disable-line react-hooks/exhaustive-deps

    // Reconnect to cluster when params change
    useEffect(() => {
        updateCluster(dispatch, cluster, customUrl);
    }, [cluster, customUrl]); // eslint-disable-line react-hooks/exhaustive-deps

    return (
        <StateContext.Provider value={state}>
            <DispatchContext.Provider value={dispatch}>
                <ModalContext.Provider value={modalState}>{children}</ModalContext.Provider>
            </DispatchContext.Provider>
        </StateContext.Provider>
    );
}

async function updateCluster(dispatch: Dispatch, cluster: Cluster, customUrl: string) {
    dispatch({
        cluster,
        customUrl,
        status: ClusterStatus.Connecting,
    });

    try {
        // validate url
        new URL(customUrl);

        const connection = new Connection(clusterUrl(cluster, customUrl));
        const [firstAvailableBlock, epochSchedule, epochInfo] = await Promise.all([
            connection.getFirstAvailableBlock(),
            connection.getEpochSchedule(),
            connection.getEpochInfo(),
        ]);

        dispatch({
            cluster,
            clusterInfo: {
                epochInfo,
                epochSchedule,
                firstAvailableBlock,
            },
            customUrl,
            status: ClusterStatus.Connected,
        });
    } catch (error) {
        if (cluster !== Cluster.Custom) {
            reportError(error, { clusterUrl: clusterUrl(cluster, customUrl) });
        }
        dispatch({
            cluster,
            customUrl,
            status: ClusterStatus.Failure,
        });
    }
}

export function useUpdateCustomUrl() {
    const dispatch = useContext(DispatchContext);
    if (!dispatch) {
        throw new Error(`useUpdateCustomUrl must be used within a ClusterProvider`);
    }

    return (customUrl: string) => {
        updateCluster(dispatch, Cluster.Custom, customUrl);
    };
}

export function useCluster() {
    const context = useContext(StateContext);
    if (!context) {
        throw new Error(`useCluster must be used within a ClusterProvider`);
    }
    return {
        ...context,
        name: clusterName(context.cluster),
        url: clusterUrl(context.cluster, context.customUrl),
    };
}

export function useClusterModal() {
    const context = useContext(ModalContext);
    if (!context) {
        throw new Error(`useClusterModal must be used within a ClusterProvider`);
    }
    return context;
}
