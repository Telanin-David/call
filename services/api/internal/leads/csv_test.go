package leads

import (
	"errors"
	"fmt"
	"reflect"
	"strings"
	"testing"
)

func TestReadCSV(t *testing.T) {
	tests := []struct {
		name    string
		in      string
		headers []string
		lines   []int
		cells   [][]string
		err     error
	}{
		{
			name:    "commas",
			in:      "First Name,Phone\nLena,(646) 555-0110\nTom,917-555-0142\n",
			headers: []string{"First Name", "Phone"},
			lines:   []int{2, 3},
			cells:   [][]string{{"Lena", "(646) 555-0110"}, {"Tom", "917-555-0142"}},
		},
		{
			name:    "Excel semicolons, byte-order mark and Windows line ends",
			in:      "\ufeffName;Phone\r\nLena Park;6465550110\r\n",
			headers: []string{"Name", "Phone"},
			lines:   []int{2},
			cells:   [][]string{{"Lena Park", "6465550110"}},
		},
		{
			name:    "tabs",
			in:      "Name\tPhone\nLena\t6465550110",
			headers: []string{"Name", "Phone"},
			lines:   []int{2},
			cells:   [][]string{{"Lena", "6465550110"}},
		},
		{
			name:    "quoted comma, a note over two lines, and line numbers that still match the file",
			in:      "Company,Phone,Notes\n\"Sparkle, Inc\",6465550110,\"Unhappy\nwith Friday cleaner\"\n\n,,\nAcme,9175550142,\n",
			headers: []string{"Company", "Phone", "Notes"},
			lines:   []int{2, 6},
			cells:   [][]string{{"Sparkle, Inc", "6465550110", "Unhappy\nwith Friday cleaner"}, {"Acme", "9175550142", ""}},
		},
		{
			name:    "blank header and a short row",
			in:      "Phone,\n6465550110\n",
			headers: []string{"Phone", "Column 2"},
			lines:   []int{2},
			cells:   [][]string{{"6465550110"}},
		},
		{name: "empty", in: " \n\n", err: ErrEmptyFile},
		{name: "header only", in: "Name,Phone\n", err: ErrEmptyFile},
		{name: "too big", in: strings.Repeat("x", MaxFileBytes+1), err: ErrFileTooBig},
		{name: "too many rows", in: "Phone\n" + strings.Repeat("6465550110\n", MaxRows+1), err: ErrTooManyRows},
		{name: "too many columns", in: strings.Repeat("a,", maxColumns) + "a\n1\n", err: ErrTooManyColumns},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			f, err := ReadCSV(tt.in)
			if !errors.Is(err, tt.err) {
				t.Fatalf("err = %v, want %v", err, tt.err)
			}
			if tt.err != nil {
				return
			}
			if !reflect.DeepEqual(f.Headers, tt.headers) {
				t.Errorf("headers = %q, want %q", f.Headers, tt.headers)
			}
			var lines []int
			var cells [][]string
			for _, r := range f.Rows {
				lines = append(lines, r.Line)
				cells = append(cells, r.Cells)
			}
			if !reflect.DeepEqual(lines, tt.lines) || !reflect.DeepEqual(cells, tt.cells) {
				t.Errorf("rows = %v %q, want %v %q", lines, cells, tt.lines, tt.cells)
			}
		})
	}
}

func TestReadCSVExactlyMaxRows(t *testing.T) {
	var b strings.Builder
	b.WriteString("Phone\n")
	for i := 0; i < MaxRows; i++ {
		fmt.Fprintf(&b, "646555%04d\n", i)
	}
	f, err := ReadCSV(b.String())
	if err != nil || len(f.Rows) != MaxRows {
		t.Fatalf("got %d rows, %v; want %d", len(f.Rows), err, MaxRows)
	}
}

func TestSuggest(t *testing.T) {
	tests := []struct {
		name string
		csv  string
		want []Field
	}{
		{
			name: "the board's file",
			csv:  "First Name,Last Name,Business,Phone,Email Address,City,Sites,Notes\nLena,Park,Sparkle Offices,(646) 555-0110,lena@x.com,\"Brooklyn, NY\",3,Hi\n",
			want: []Field{FirstName, LastName, Company, Phone, Email, City, Skip, Notes},
		},
		{
			name: "full name and two phone columns: the first wins",
			csv:  "Name,Mobile,Office Phone,Company Name\nLena Park,6465550110,2125550123,Sparkle\n",
			want: []Field{FullName, Phone, Skip, Company},
		},
		{
			name: "no phone header: found from the data",
			csv:  "Contact,Number of sites,Digits\nLena Park,3,646-555-0110\nTom,4,917 555 0142\n",
			want: []Field{FullName, Skip, Phone},
		},
		{
			name: "full name is dropped when first and last names exist",
			csv:  "Name,First,Surname,Tel\nLena Park,Lena,Park,6465550110\n",
			want: []Field{Skip, FirstName, LastName, Phone},
		},
		{
			name: "nothing looks like a phone",
			csv:  "Name,Sites\nLena,3\n",
			want: []Field{FullName, Skip},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			f, err := ReadCSV(tt.csv)
			if err != nil {
				t.Fatal(err)
			}
			if got := Suggest(f); !reflect.DeepEqual(got, tt.want) {
				t.Errorf("Suggest = %v, want %v", got, tt.want)
			}
		})
	}
}

func TestCheckMapping(t *testing.T) {
	tests := []struct {
		m   []Field
		err error
	}{
		{[]Field{FirstName, Phone, Skip, Skip}, nil},
		{[]Field{FullName, Phone, Company, Notes}, nil},
		{[]Field{FirstName, Phone}, ErrBadMapping},
		{[]Field{FirstName, Phone, "age", Skip}, ErrBadMapping},
		{[]Field{Phone, Phone, Skip, Skip}, ErrFieldTwice},
		{[]Field{FirstName, Skip, Skip, Skip}, ErrNoPhoneColumn},
		{[]Field{FullName, FirstName, Phone, Skip}, ErrNameTwice},
	}
	for _, tt := range tests {
		if err := checkMapping(tt.m, 4); !errors.Is(err, tt.err) {
			t.Errorf("checkMapping(%v) = %v, want %v", tt.m, err, tt.err)
		}
	}
}

func TestRead(t *testing.T) {
	r := Row{Line: 7, Cells: []string{"  Lena   Mae Park ", "Sparkle", "LENA@X.COM", "(646) 555-0110"}}
	l, raw := read(r, []Field{FullName, Company, Email, Phone})
	want := Lead{Line: 7, FirstName: "Lena", LastName: "Mae Park", Company: "Sparkle", Email: "lena@x.com"}
	if l != want || raw != "(646) 555-0110" {
		t.Fatalf("read = %+v %q, want %+v", l, raw, want)
	}
	if got := (Lead{Company: "Sparkle"}).Name(); got != "Sparkle" {
		t.Errorf("Name without a person = %q, want the company", got)
	}
}
