import React, { useRef, useState, useEffect } from 'react';
import { StyleSheet, SafeAreaView, BackHandler, Platform, StatusBar, PermissionsAndroid } from 'react-native';
import { WebView } from 'react-native-webview';

export default function App() {
  const webViewRef = useRef(null);
  const [canGoBack, setCanGoBack] = useState(false);

  // ขอสิทธิ์การเข้าถึงกล้องบนระบบ Android เมื่อเปิดแอป
  useEffect(() => {
    const requestCameraPermission = async () => {
      if (Platform.OS === 'android') {
        try {
          const granted = await PermissionsAndroid.request(
            PermissionsAndroid.PERMISSIONS.CAMERA,
            {
              title: 'ขอสิทธิ์เข้าถึงกล้องถ่ายภาพ',
              message: 'ระบบลองแว่นเสมือนจริง (Virtual Try-On) จำเป็นต้องขอใช้งานกล้องเพื่อตรวจจับพิกัดใบหน้า',
              buttonPositive: 'ตกลง',
            }
          );
          if (granted === PermissionsAndroid.RESULTS.GRANTED) {
            console.log('Camera permission granted successfully');
          } else {
            console.log('Camera permission denied by user');
          }
        } catch (err) {
          console.warn(err);
        }
      }
    };
    requestCameraPermission();
  }, []);

  // จัดการปุ่มกด Back บน Android
  useEffect(() => {
    const onBackPress = () => {
      if (webViewRef.current && canGoBack) {
        webViewRef.current.goBack();
        return true; // ป้องกันไม่ให้แอปปิดตัวลง
      }
      return false; // ปล่อยให้ปิดแอปตามปกติ (ถ้าอยู่ที่หน้าแรกสุด)
    };

    if (Platform.OS === 'android') {
      BackHandler.addEventListener('hardwareBackPress', onBackPress);
    }

    return () => {
      if (Platform.OS === 'android') {
        BackHandler.removeEventListener('hardwareBackPress', onBackPress);
      }
    };
  }, [canGoBack]);

  const handleNavigationStateChange = (navState) => {
    setCanGoBack(navState.canGoBack);
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor="#ffffff" />
      <WebView
        ref={webViewRef}
        source={{ uri: 'https://baan-waenta.onrender.com/' }}
        style={styles.webview}
        javaScriptEnabled={true}
        domStorageEnabled={true}
        allowsInlineMediaPlayback={true} // สำคัญมากสำหรับกล้อง Virtual Try-On บน iOS
        mediaPlaybackRequiresUserAction={false}
        originWhitelist={['*']}
        onNavigationStateChange={handleNavigationStateChange}
        // จัดการอนุญาตคำขอสิทธิ์กล้องของหน้าเว็บ (WebRTC getUserMedia) บน Android
        onPermissionRequest={(event) => {
          const { request } = event.nativeEvent;
          request.grant(request.resources);
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#ffffff',
    // SafeAreaView handles iOS, but Android needs manual paddingTop for status bar
    paddingTop: Platform.OS === 'android' ? StatusBar.currentHeight : 0,
  },
  webview: {
    flex: 1,
  },
});
