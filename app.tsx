
import React, { useState, useEffect, useRef } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  FlatList,
  SafeAreaView,
  ActivityIndicator,
  Alert,
  Modal,
  ScrollView,
  StatusBar
} from 'react-native';
import MapView, { Polyline, Marker, PROVIDER_DEFAULT } from 'react-native-maps';
import * as Location from 'expo-location';
import AsyncStorage from '@react-native-async-storage/async-storage';

// --- TYPE SCHEMAS & UTILITIES ---
interface Coordinate {
  latitude: number;
  longitude: number;
  timestamp: number;
}

interface RunActivity {
  id: string;
  date: string;
  type: 'Run' | 'Walk';
  duration: number; // seconds
  distance: number; // meters
  avgPace: string;
  coordinates: Coordinate[];
}

type TabScreen = 'Home' | 'Run' | 'History';

const ASYNC_STORAGE_KEY = '@runforge_activities_v1';

// Haversine formula to compute distance in meters between GPS points
const getDistanceBetweenPoints = (lat1: number, lon1: number, lat2: number, lon2: number): number => {
  const R = 6371000; // Earth's radius in meters
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
};

const formatTime = (totalSeconds: number): string => {
  const hrs = Math.floor(totalSeconds / 3600);
  const mins = Math.floor((totalSeconds % 3600) / 60);
  const secs = totalSeconds % 60;
  return `${hrs > 0 ? hrs + ':' : ''}${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
};

const formatDistanceKM = (meters: number): string => {
  return (meters / 1000).toFixed(2) + ' km';
};

const computePace = (seconds: number, meters: number): string => {
  if (meters <= 0) return "0'00\"/km";
  const km = meters / 1000;
  const totalMinutes = seconds / 60;
  const paceDecimal = totalMinutes / km;
  const mins = Math.floor(paceDecimal);
  const secs = Math.floor((paceDecimal - mins) * 60);
  return `${mins}'${secs.toString().padStart(2, '0')}"/km`;
};

export default function App() {
  // Navigation & Data Store State
  const [currentTab, setCurrentTab] = useState<TabScreen>('Home');
  const [activities, setActivities] = useState<RunActivity[]>([]);
  const [selectedActivity, setSelectedActivity] = useState<RunActivity | null>(null);
  
  // Real-Time Location & Tracking Engine State
  const [isTracking, setIsTracking] = useState<boolean>(false);
  const [isPaused, setIsPaused] = useState<boolean>(false);
  const [duration, setDuration] = useState<number>(0);
  const [distance, setDistance] = useState<number>(0);
  const [routeTrack, setRouteTrack] = useState<Coordinate[]>([]);
  const [liveLocation, setLiveLocation] = useState<Location.LocationObject | null>(null);

  const trackingTimerRef = useRef<NodeJS.Timeout | null>(null);
  const locationWatcherRef = useRef<Location.LocationSubscription | null>(null);

  // Sync Data and Permissions on Launch
  useEffect(() => {
    initializeAppData();
    return () => clearTrackingTokens();
  }, []);

  const initializeAppData = async () => {
    try {
      const storedData = await AsyncStorage.getItem(ASYNC_STORAGE_KEY);
      if (storedData) {
        setActivities(JSON.parse(storedData));
      }
    } catch (err) {
      console.error("Storage read failure", err);
    }

    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status === 'granted') {
      const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      setLiveLocation(position);
    }
  };

  const clearTrackingTokens = () => {
    if (trackingTimerRef.current) clearInterval(trackingTimerRef.current);
    if (locationWatcherRef.current) {
      locationWatcherRef.current.remove();
      locationWatcherRef.current = null;
    }
  };

  // --- MOTOR TRACKING CORE LOGIC ---
  const startTrackingEngine = async () => {
    const { status } = await Location.getForegroundPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert("Permission Required", "Please enable location accuracy access permissions to track your workouts.");
      return;
    }

    setIsTracking(true);
    setIsPaused(false);
    setDuration(0);
    setDistance(0);
    setRouteTrack([]);

    trackingTimerRef.current = setInterval(() => {
      setDuration((prev) => prev + 1);
    }, 1000);

    locationWatcherRef.current = await Location.watchPositionAsync(
      {
        accuracy: Location.Accuracy.BestForNavigation,
        timeInterval: 1000,
        distanceInterval: 2,
      },
      (location) => {
        setLiveLocation(location);
        const { latitude, longitude } = location.coords;
        const newPoint: Coordinate = { latitude, longitude, timestamp: location.timestamp };

        setRouteTrack((currentTrack) => {
          if (currentTrack.length > 0) {
            const previousPoint = currentTrack[currentTrack.length - 1];
            const incrementalDistance = getDistanceBetweenPoints(
              previousPoint.latitude,
              previousPoint.longitude,
              newPoint.latitude,
              newPoint.longitude
            );
            
            if (incrementalDistance > 0.5) {
              setDistance((prevDistance) => prevDistance + incrementalDistance);
            }
          }
          return [...currentTrack, newPoint];
        });
      }
    );
  };

  const pauseTrackingEngine = () => {
    if (trackingTimerRef.current) {
      clearInterval(trackingTimerRef.current);
      trackingTimerRef.current = null;
    }
    if (locationWatcherRef.current) {
      locationWatcherRef.current.remove();
      locationWatcherRef.current = null;
    }
    setIsPaused(true);
  };

  const resumeTrackingEngine = async () => {
    setIsPaused(false);
    trackingTimerRef.current = setInterval(() => {
      setDuration((prev) => prev + 1);
    }, 1000);

    locationWatcherRef.current = await Location.watchPositionAsync(
      {
        accuracy: Location.Accuracy.BestForNavigation,
        timeInterval: 1000,
        distanceInterval: 2,
      },
      (location) => {
        setLiveLocation(location);
        const { latitude, longitude } = location.coords;
        const newPoint: Coordinate = { latitude, longitude, timestamp: location.timestamp };

        setRouteTrack((currentTrack) => {
          if (currentTrack.length > 0) {
            const previousPoint = currentTrack[currentTrack.length - 1];
            const incrementalDistance = getDistanceBetweenPoints(
              previousPoint.latitude,
              previousPoint.longitude,
              newPoint.latitude,
              newPoint.longitude
            );
            if (incrementalDistance > 0.5) {
              setDistance((prevDistance) => prevDistance + incrementalDistance);
            }
          }
          return [...currentTrack, newPoint];
        });
      }
    );
  };

  const completeAndSaveActivity = async () => {
    clearTrackingTokens();
    setIsTracking(false);
    setIsPaused(false);

    if (routeTrack.length < 2 || distance < 5) {
      Alert.alert("Activity Too Short", "RunForge requires a minimum distance history entry to register a save profile.");
      setCurrentTab('Home');
      return;
    }

    const calculatedPace = computePace(duration, distance);
    const newWorkout: RunActivity = {
      id: Date.now().toString(),
      date: new Date().toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      }),
      type: 'Run',
      duration,
      distance,
      avgPace: calculatedPace,
      coordinates: routeTrack,
    };

    const updatedList = [newWorkout, ...activities];
    setActivities(updatedList);
    try {
      await AsyncStorage.setItem(ASYNC_STORAGE_KEY, JSON.stringify(updatedList));
    } catch (err) {
      Alert.alert("Save Interrupted", "Could not complete local database save operation.");
    }
    setCurrentTab('History');
  };

  // --- SCREEN RENDERS ---

  // SCREEN A: HOME MODULE
  const renderHomeScreen = () => {
    const aggregateDistance = activities.reduce((acc, act) => acc + act.distance, 0);
    const aggregateTime = activities.reduce((acc, act) => acc + act.duration, 0);

    return (
      <ScrollView style={styles.viewBody} contentContainerStyle={{ paddingBottom: 24 }}>
        <View style={styles.brandContainer}>
          <Text style={styles.brandTitleText}>RUN<Text style={{ color: '#FC5200' }}>FORGE</Text></Text>
          <Text style={styles.brandSubText}>Version 1.0 Active</Text>
        </View>

        <View style={styles.metricsGridCard}>
          <Text style={styles.cardHeaderTitle}>ALL-TIME METRICS</Text>
          <View style={styles.gridRow}>
            <View style={styles.gridBlock}>
              <Text style={styles.gridLabel}>DISTANCE</Text>
              <Text style={styles.gridValue}>{formatDistanceKM(aggregateDistance)}</Text>
            </View>
            <View style={styles.gridSeparator} />
            <View style={styles.gridBlock}>
              <Text style={styles.gridLabel}>ACTIVITIES</Text>
              <Text style={styles.gridValue}>{activities.length}</Text>
            </View>
          </View>
          <View style={[styles.gridRow, { marginTop: 20, paddingTop: 16, borderTopWidth: 1, borderTopColor: '#2A2A2E' }]}>
            <View style={styles.gridBlock}>
              <Text style={styles.gridLabel}>TOTAL TIME</Text>
              <Text style={styles.gridValue}>{formatTime(aggregateTime)}</Text>
            </View>
          </View>
        </View>

        <TouchableOpacity 
          style={styles.primaryLaunchActionButton}
          onPress={() => {
            setCurrentTab('Run');
            startTrackingEngine();
          }}
        >
          <Text style={styles.primaryLaunchButtonText}>QUICK START RUN</Text>
        </TouchableOpacity>

        <Text style={styles.sectionHeaderTitle}>RECENT ACTIVITIES</Text>
        {activities.slice(0, 3).map((item) => (
          <TouchableOpacity key={item.id} style={styles.historyListItemRow} onPress={() => setSelectedActivity(item)}>
            <View style={{ flex: 1 }}>
              <Text style={styles.historyRowDateText}>{item.date}</Text>
              <View style={styles.inlineStatsContainer}>
                <Text style={styles.inlineStatText}>Dist: <Text style={styles.highlightWhite}>{formatDistanceKM(item.distance)}</Text></Text>
                <Text style={styles.inlineStatText}>Time: <Text style={styles.highlightWhite}>{formatTime(item.duration)}</Text></Text>
              </View>
            </View>
            <Text style={styles.arrowIconSymbol}>➔</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
    );
  };

  // SCREEN B: RUN TRACKER MODULE
  const renderRunScreen = () => {
    const fallbackCoordinates = { latitude: 37.78825, longitude: -122.4324 };
    const baseRegionSetting = liveLocation ? {
      latitude: liveLocation.coords.latitude,
      longitude: liveLocation.coords.longitude,
      latitudeDelta: 0.004,
      longitudeDelta: 0.004,
    } : {
      ...fallbackCoordinates,
      latitudeDelta: 0.05,
      longitudeDelta: 0.05,
    };

    return (
      <View style={styles.viewportContainer}>
        <MapView
          style={styles.mapCanvas}
          provider={PROVIDER_DEFAULT}
          showsUserLocation={true}
          followsUserLocation={true}
          region={baseRegionSetting}
          userInterfaceStyle="dark"
        >
          {routeTrack.length > 1 && (
            <Polyline coordinates={routeTrack} strokeWidth={6} strokeColor="#FC5200" />
          )}
          {routeTrack.length > 0 && (
            <Marker coordinate={routeTrack[0]} title="Start Location" pinColor="#00E676" />
          )}
        </MapView>

        <View style={styles.dashboardPanelOverlay}>
          <View style={styles.realtimeStatsRow}>
            <View style={styles.statsPanelUnit}>
              <Text style={styles.panelUnitLabel}>TIME</Text>
              <Text style={styles.panelUnitValue}>{formatTime(duration)}</Text>
            </View>
            <View style={styles.statsPanelUnit}>
              <Text style={styles.panelUnitLabel}>DISTANCE</Text>
              <Text style={styles.panelUnitValue}>{formatDistanceKM(distance)}</Text>
            </View>
            <View style={styles.statsPanelUnit}>
              <Text style={styles.panelUnitLabel}>PACE</Text>
              <Text style={styles.panelUnitValue}>{computePace(duration, distance)}</Text>
            </View>
          </View>

          <View style={styles.controlInteractionRow}>
            {!isTracking ? (
              <TouchableOpacity style={[styles.controlCircleButton, { backgroundColor: '#00E676' }]} onPress={startTrackingEngine}>
                <Text style={styles.controlButtonLabelText}>START</Text>
              </TouchableOpacity>
            ) : (
              <>
                {!isPaused ? (
                  <TouchableOpacity style={[styles.controlCircleButton, { backgroundColor: '#FFA000' }]} onPress={pauseTrackingEngine}>
                    <Text style={styles.controlButtonLabelText}>PAUSE</Text>
                  </TouchableOpacity>
                ) : (
                  <TouchableOpacity style={[styles.controlCircleButton, { backgroundColor: '#00E676' }]} onPress={resumeTrackingEngine}>
                    <Text style={styles.controlButtonLabelText}>RESUME</Text>
                  </TouchableOpacity>
                )}

                <TouchableOpacity style={[styles.controlCircleButton, { backgroundColor: '#FF1744' }]} onPress={completeAndSaveActivity}>
                  <Text style={styles.controlButtonLabelText}>END</Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        </View>
      </View>
    );
  };

  // SCREEN C: HISTORICAL ARCHIVE LIST
  const renderHistoryScreen = () => {
    return (
      <View style={styles.viewportContainer}>
        <View style={styles.moduleHeaderBar}>
          <Text style={styles.moduleHeaderBarTitle}>WORKOUT HISTORY</Text>
        </View>
        <FlatList
          data={activities}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
          ListEmptyComponent={
            <View style={styles.fallbackEmptyStateFrame}>
              <Text style={styles.fallbackEmptyStateText}>No recorded runs found in local storage modules.</Text>
            </View>
          }
          renderItem={({ item }) => (
            <TouchableOpacity style={styles.historyListItemRow} onPress={() => setSelectedActivity(item)}>
              <View style={{ flex: 1 }}>
                <Text style={styles.historyRowDateText}>{item.date}</Text>
                <View style={styles.metricsClusterRow}>
                  <View style={{ marginRight: 24 }}>
                    <Text style={styles.miniLabel}>DISTANCE</Text>
                    <Text style={styles.miniValue}>{formatDistanceKM(item.distance)}</Text>
                  </View>
                  <View style={{ marginRight: 24 }}>
                    <Text style={styles.miniLabel}>TIME</Text>
                    <Text style={styles.miniValue}>{formatTime(item.duration)}</Text>
                  </View>
                  <View>
                    <Text style={styles.miniLabel}>AVG PACE</Text>
                    <Text style={styles.miniValue}>{item.avgPace}</Text>
                  </View>
                </View>
              </View>
              <Text style={styles.arrowIconSymbol}>➔</Text>
            </TouchableOpacity>
          )}
        />
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.globalSafeWrapper}>
      <StatusBar barStyle="light-content" backgroundColor="#121212" />
      <View style={styles.viewportContainer}>
        {currentTab === 'Home' && renderHomeScreen()}
        {currentTab === 'Run' && renderRunScreen()}
        {currentTab === 'History' && renderHistoryScreen()}
      </View>

      {/* DETAILED WORKOUT OVERLAY MODAL */}
      {selectedActivity && (
        <Modal animationType="slide" transparent={false} visible={!!selectedActivity}>
          <SafeAreaView style={[styles.globalSafeWrapper, { backgroundColor: '#121212' }]}>
            <View style={styles.modalHeaderBar}>
              <Text style={styles.modalHeaderTitle}>Activity Details</Text>
              <TouchableOpacity style={styles.modalCloseInteractiveText} onPress={() => setSelectedActivity(null)}>
                <Text style={styles.modalCloseButtonString}>CLOSE</Text>
              </TouchableOpacity>
            </View>

            <MapView
              style={{ flex: 1 }}
              provider={PROVIDER_DEFAULT}
              userInterfaceStyle="dark"
              initialRegion={{
                latitude: selectedActivity.coordinates[0]?.latitude || 37.78825,
                longitude: selectedActivity.coordinates[0]?.longitude || -122.4324,
                latitudeDelta: 0.015,
                longitudeDelta: 0.015,
              }}
            >
              <Polyline coordinates={selectedActivity.coordinates} strokeWidth={6} strokeColor="#FC5200" />
              <Marker coordinate={selectedActivity.coordinates[0]} pinColor="#00E676" title="Start Point" />
              <Marker coordinate={selectedActivity.coordinates[selectedActivity.coordinates.length - 1]} pinColor="#FF1744" title="End Point" />
            </MapView>

            <View style={styles.modalMetricsCardStack}>
              <Text style={styles.modalDateStampString}>{selectedActivity.date}</Text>
              <View style={styles.realtimeStatsRow}>
                <View style={styles.statsPanelUnit}>
                  <Text style={styles.panelUnitLabel}>DISTANCE</Text>
                  <Text style={[styles.panelUnitValue, { color: '#FC5200' }]}>{formatDistanceKM(selectedActivity.distance)}</Text>
                </View>
                <View style={styles.statsPanelUnit}>
                  <Text style={styles.panelUnitLabel}>DURATION</Text>
                  <Text style={styles.panelUnitValue}>{formatTime(selectedActivity.duration)}</Text>
                </View>
                <View style={styles.statsPanelUnit}>
                  <Text style={styles.panelUnitLabel}>AVG PACE</Text>
                  <Text style={styles.panelUnitValue}>{selectedActivity.avgPace}</Text>
                </View>
              </View>
            </View>
          </SafeAreaView>
        </Modal>
      )}

      {/* SYSTEM BOTTOM TAB NAVIGATION COMPONENT */}
      {!isTracking && (
        <View style={styles.navigationTabBarContainer}>
          <TouchableOpacity style={[styles.tabTriggerCell, currentTab === 'Home' && styles.tabTriggerActiveHighlight]} onPress={() => setCurrentTab('Home')}>
            <Text style={[styles.tabTriggerLabelText, currentTab === 'Home' && styles.tabTriggerLabelTextActive]}>Home</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.tabTriggerCell, currentTab === 'Run' && styles.tabTriggerActiveHighlight]} onPress={() => setCurrentTab('Run')}>
            <Text style={[styles.tabTriggerLabelText, currentTab === 'Run' && styles.tabTriggerLabelTextActive]}>Record</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.tabTriggerCell, currentTab === 'History' && styles.tabTriggerActiveHighlight]} onPress={() => setCurrentTab('History')}>
            <Text style={[styles.tabTriggerLabelText, currentTab === 'History' && styles.tabTriggerLabelTextActive]}>History</Text>
          </TouchableOpacity>
        </View>
      )}
    </SafeAreaView>
  );
}

// --- STRAVA-INSPIRED PREMIUM DARK THEME STYLES ---
const styles = StyleSheet.create
