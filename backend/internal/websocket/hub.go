// Package websocket pushes live updates to browser clients.
//
// The Hub goroutine is the only code that touches the clients map, so no
// mutex is needed; other goroutines talk to it through channels. Each client
// has its own writer goroutine, so a connection is never written to
// concurrently, and a slow client can't block the others.
package websocket

import (
	"context"
	"log/slog"
	"net/http"
	"slices"
	"time"

	"github.com/gorilla/websocket"
)

type client struct {
	conn *websocket.Conn
	send chan []byte // buffered; if it fills up the client is too slow
}

type Hub struct {
	register   chan *client
	unregister chan *client
	broadcast  chan []byte
	clients    map[*client]bool
	upgrader   websocket.Upgrader
}

func NewHub(allowedOrigins []string) *Hub {
	return &Hub{
		register:   make(chan *client),
		unregister: make(chan *client),
		broadcast:  make(chan []byte, 256),
		clients:    make(map[*client]bool),
		upgrader: websocket.Upgrader{
			CheckOrigin: func(r *http.Request) bool {
				origin := r.Header.Get("Origin")
				return origin == "" || slices.Contains(allowedOrigins, origin)
			},
		},
	}
}

// Run serves the hub until ctx is cancelled, then disconnects everyone.
func (h *Hub) Run(ctx context.Context) {
	for {
		select {
		case c := <-h.register:
			h.clients[c] = true
			slog.Info("websocket client connected", "clients", len(h.clients))

		case c := <-h.unregister:
			if h.clients[c] {
				delete(h.clients, c)
				close(c.send)
				slog.Info("websocket client disconnected", "clients", len(h.clients))
			}

		case msg := <-h.broadcast:
			for c := range h.clients {
				select {
				case c.send <- msg:
				default:
					// Buffer full: drop this client instead of waiting for it.
					delete(h.clients, c)
					close(c.send)
					slog.Warn("dropping slow websocket client")
				}
			}

		case <-ctx.Done():
			for c := range h.clients {
				close(c.send) // writer sends a close frame and exits
			}
			h.clients = nil
			return
		}
	}
}

// Broadcast queues a message for all clients. Never blocks the caller for long.
func (h *Hub) Broadcast(msg []byte) {
	select {
	case h.broadcast <- msg:
	default:
		slog.Warn("broadcast queue full, dropping update")
	}
}

// ServeHTTP upgrades GET /api/v1/ws to a WebSocket connection.
func (h *Hub) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	conn, err := h.upgrader.Upgrade(w, r, nil)
	if err != nil {
		slog.Warn("websocket upgrade failed", "error", err)
		return
	}
	c := &client{conn: conn, send: make(chan []byte, 64)}
	select {
	case h.register <- c:
	case <-r.Context().Done():
		conn.Close()
		return
	}
	go h.writeLoop(c)
	go h.readLoop(c)
}

// writeLoop is the only goroutine that writes to the connection.
func (h *Hub) writeLoop(c *client) {
	ping := time.NewTicker(30 * time.Second)
	defer func() {
		ping.Stop()
		c.conn.Close()
	}()
	for {
		select {
		case msg, ok := <-c.send:
			c.conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
			if !ok {
				c.conn.WriteMessage(websocket.CloseMessage, websocket.FormatCloseMessage(websocket.CloseGoingAway, ""))
				return
			}
			if err := c.conn.WriteMessage(websocket.TextMessage, msg); err != nil {
				return
			}
		case <-ping.C:
			c.conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
			if err := c.conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		}
	}
}

// readLoop detects when the browser goes away (close frame, error, or no
// pong within 60s) and unregisters the client.
func (h *Hub) readLoop(c *client) {
	defer func() {
		select {
		case h.unregister <- c:
		case <-time.After(time.Second): // hub already stopped
		}
		c.conn.Close()
	}()
	c.conn.SetReadDeadline(time.Now().Add(60 * time.Second))
	c.conn.SetPongHandler(func(string) error {
		return c.conn.SetReadDeadline(time.Now().Add(60 * time.Second))
	})
	for {
		if _, _, err := c.conn.ReadMessage(); err != nil {
			return
		}
	}
}
