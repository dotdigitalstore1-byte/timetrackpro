import { CameraView, useCameraPermissions } from 'expo-camera';
import { useRef, useState } from 'react';
import { StyleSheet, Text, View, Pressable } from 'react-native';
import type { AttendanceRecord } from '../api/types';
import { ErrorBox, PrimaryButton, Card, SectionTitle } from '../components/ui';
import { readDeviceSecurity, blockedMessage } from '../security/deviceSecurity';
import { colors, radius } from '../theme';
import { captureLivePhoto } from './capture';
import { submitPunch, type PunchType } from './submitPunch';

interface Props {
  record: AttendanceRecord | null;
  onDone: () => void;
}

type Mode = 'idle' | 'camera' | 'working';

/** Punch-in / punch-out for today. Shows only the action that applies to the current state. */
export function PunchPanel({ record, onDone }: Props) {
  const cameraRef = useRef<CameraView>(null);
  const [permission, requestPermission] = useCameraPermissions();
  const [mode, setMode] = useState<Mode>('idle');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const action: PunchType | null = !record?.punchInTime ? 'in' : !record.punchOutTime ? 'out' : null;

  const start = async () => {
    setError(null);
    setSuccess(null);
    const security = readDeviceSecurity();
    if (security.blocked) {
      setError(blockedMessage(security));
      return;
    }
    if (!permission?.granted) {
      const result = await requestPermission();
      if (!result.granted) {
        setError('Camera permission is needed for the attendance photo. Allow it in Settings and try again.');
        return;
      }
    }
    setMode('camera');
  };

  const capture = async () => {
    if (!cameraRef.current || !action) return;
    setError(null);
    setMode('working');
    try {
      const photo = await captureLivePhoto(cameraRef.current);
      const result = await submitPunch(action, photo);
      setMode('idle');
      setSuccess(
        result.duplicate
          ? 'This punch was already recorded.'
          : action === 'in'
            ? 'Punch-in recorded successfully.'
            : 'Punch-out recorded successfully.'
      );
      onDone();
    } catch (e) {
      setMode('idle');
      setError(e instanceof Error ? e.message : 'Punch failed. Please try again.');
      onDone();
    }
  };

  if (!action) {
    return (
      <Card>
        <SectionTitle>Today&apos;s punch</SectionTitle>
        <Text style={styles.note}>You have punched in and out for today.</Text>
        {success ? <Text style={styles.success}>{success}</Text> : null}
      </Card>
    );
  }

  return (
    <Card>
      <SectionTitle>{action === 'in' ? 'Punch in' : 'Punch out'}</SectionTitle>
      {error ? <ErrorBox message={error} /> : null}
      {success ? <Text style={styles.success}>{success}</Text> : null}

      {mode === 'camera' ? (
        <>
          <Text style={styles.note}>Take a live photo. Gallery photos are not accepted.</Text>
          <View style={styles.cameraWrap}>
            <CameraView ref={cameraRef} style={styles.camera} facing="back" />
          </View>
          <PrimaryButton label="Take photo and punch" onPress={capture} />
          <Pressable onPress={() => setMode('idle')} style={styles.cancel} accessibilityRole="button">
            <Text style={styles.cancelText}>Cancel</Text>
          </Pressable>
        </>
      ) : mode === 'working' ? (
        <Text style={styles.note}>Checking your location and sending the punch…</Text>
      ) : (
        <PrimaryButton label={action === 'in' ? 'Punch in' : 'Punch out'} onPress={start} />
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  note: { color: colors.slate600, fontSize: 13, marginBottom: 10 },
  success: { color: colors.green700, fontSize: 13, fontWeight: '600', marginBottom: 8 },
  cameraWrap: { height: 340, borderRadius: radius.md, overflow: 'hidden', backgroundColor: colors.slate900, marginBottom: 12 },
  camera: { flex: 1 },
  cancel: { alignItems: 'center', paddingVertical: 10 },
  cancelText: { color: colors.indigo600, fontWeight: '600' },
});
