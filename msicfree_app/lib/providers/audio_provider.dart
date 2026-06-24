import 'package:flutter/material.dart';
import 'package:just_audio/just_audio.dart';
import '../models/track.dart';
import '../services/youtube_service.dart';

enum TrackRepeatMode { off, all, one }

class AudioProvider extends ChangeNotifier {
  final AudioPlayer _player = AudioPlayer();
  final YouTubeService _ytService = YouTubeService();

  // State
  Track? _currentTrack;
  List<Track> _queue = [];
  int _currentIndex = -1;
  bool _isPlaying = false;
  bool _isLoading = false;
  bool _shuffle = false;
  TrackRepeatMode _repeatMode = TrackRepeatMode.off;
  Duration _position = Duration.zero;
  Duration _duration = Duration.zero;
  List<Track> _history = [];
  String? _errorMessage;

  // Getters
  Track? get currentTrack => _currentTrack;
  List<Track> get queue => _queue;
  int get currentIndex => _currentIndex;
  bool get isPlaying => _isPlaying;
  bool get isLoading => _isLoading;
  bool get shuffle => _shuffle;
  TrackRepeatMode get repeatMode => _repeatMode;
  Duration get position => _position;
  Duration get duration => _duration;
  List<Track> get history => List.unmodifiable(_history);
  String? get errorMessage => _errorMessage;
  double get progress =>
      _duration.inMilliseconds > 0
          ? _position.inMilliseconds / _duration.inMilliseconds
          : 0.0;

  AudioProvider() {
    _initListeners();
  }

  void _initListeners() {
    _player.positionStream.listen((pos) {
      _position = pos;
      notifyListeners();
    });

    _player.durationStream.listen((dur) {
      _duration = dur ?? Duration.zero;
      notifyListeners();
    });

    _player.playingStream.listen((playing) {
      _isPlaying = playing;
      notifyListeners();
    });

    _player.processingStateStream.listen((state) {
      if (state == ProcessingState.completed) {
        _onTrackCompleted();
      }
    });
  }

  /// Play a track (resolve YouTube audio -> play)
  Future<void> playTrack(Track track) async {
    _isLoading = true;
    _currentTrack = track;
    _errorMessage = null;
    notifyListeners();

    try {
      debugPrint('[Audio] Playing: ${track.title} by ${track.artist}');

      // Find YouTube video
      debugPrint('[Audio] Searching YouTube...');
      final videoId = track.youtubeId ?? await _ytService.findVideoId(track);
      if (videoId == null) {
        debugPrint('[Audio] ERROR: No YouTube video found');
        _isLoading = false;
        _errorMessage = 'Could not find this song on YouTube';
        notifyListeners();
        return;
      }
      debugPrint('[Audio] Found video: $videoId');

      // Get audio stream URL
      debugPrint('[Audio] Getting audio stream...');
      final audioUrl = await _ytService.getAudioStreamUrl(videoId);
      if (audioUrl == null) {
        debugPrint('[Audio] ERROR: No audio stream available');
        _isLoading = false;
        _errorMessage = 'Could not get audio stream';
        notifyListeners();
        return;
      }
      debugPrint('[Audio] Got stream URL (${audioUrl.length} chars)');

      // Update track with youtubeId
      _currentTrack = track.copyWith(youtubeId: videoId);

      // Add to history
      _history.removeWhere((t) => t.id == track.id);
      _history.insert(0, _currentTrack!);
      if (_history.length > 50) _history = _history.sublist(0, 50);

      // Play
      debugPrint('[Audio] Setting URL on player...');
      await _player.setUrl(audioUrl);
      debugPrint('[Audio] Playing...');
      await _player.play();

      _isLoading = false;
      _errorMessage = null;
      notifyListeners();
      debugPrint('[Audio] Playback started successfully!');
    } catch (e, stackTrace) {
      debugPrint('[Audio] ERROR: $e');
      debugPrint('[Audio] Stack: $stackTrace');
      _isLoading = false;
      _errorMessage = 'Playback error: ${e.toString().split('\n').first}';
      notifyListeners();
    }
  }

  /// Set queue and play from index
  void setQueue(List<Track> tracks, int startIndex) {
    _queue = List.from(tracks);
    _currentIndex = startIndex;
    if (startIndex >= 0 && startIndex < tracks.length) {
      playTrack(tracks[startIndex]);
    }
  }

  /// Add single track to end of queue
  void addToQueue(Track track) {
    _queue.add(track);
    notifyListeners();
  }

  /// Toggle play/pause
  Future<void> togglePlayPause() async {
    if (_isPlaying) {
      await _player.pause();
    } else {
      await _player.play();
    }
  }

  /// Seek to position
  Future<void> seekTo(Duration position) async {
    await _player.seek(position);
  }

  /// Next track
  Future<void> next() async {
    if (_queue.isEmpty) return;

    if (_shuffle) {
      _currentIndex = (List.generate(_queue.length, (i) => i)..shuffle()).first;
    } else {
      _currentIndex++;
      if (_currentIndex >= _queue.length) {
        if (_repeatMode == TrackRepeatMode.all) {
          _currentIndex = 0;
        } else {
          _currentIndex = _queue.length - 1;
          return;
        }
      }
    }

    await playTrack(_queue[_currentIndex]);
  }

  /// Previous track
  Future<void> previous() async {
    if (_position.inSeconds > 3) {
      await seekTo(Duration.zero);
      return;
    }

    if (_queue.isEmpty) return;

    _currentIndex--;
    if (_currentIndex < 0) {
      _currentIndex = _repeatMode == TrackRepeatMode.all ? _queue.length - 1 : 0;
    }

    await playTrack(_queue[_currentIndex]);
  }

  /// Toggle shuffle
  void toggleShuffle() {
    _shuffle = !_shuffle;
    notifyListeners();
  }

  /// Cycle repeat mode
  void toggleRepeat() {
    switch (_repeatMode) {
      case TrackRepeatMode.off:
        _repeatMode = TrackRepeatMode.all;
      case TrackRepeatMode.all:
        _repeatMode = TrackRepeatMode.one;
      case TrackRepeatMode.one:
        _repeatMode = TrackRepeatMode.off;
    }
    notifyListeners();
  }

  /// Clear history
  void clearHistory() {
    _history.clear();
    notifyListeners();
  }

  void _onTrackCompleted() {
    if (_repeatMode == TrackRepeatMode.one) {
      _player.seek(Duration.zero);
      _player.play();
    } else {
      next();
    }
  }

  @override
  void dispose() {
    _player.dispose();
    _ytService.dispose();
    super.dispose();
  }
}
