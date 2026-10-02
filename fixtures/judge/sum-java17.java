import java.util.Scanner;

public class Main {
    record Pair(long a, long b) {}
    static class Adder {
        long sum(Pair pair) { return Extra.add(pair.a(), pair.b()); }
    }
    public static void main(String[] args) {
        if (!System.getProperty("java.specification.version").equals("17")) {
            throw new IllegalStateException("JDK 17 required");
        }
        Scanner input = new Scanner(System.in);
        System.out.println(new Adder().sum(new Pair(input.nextLong(), input.nextLong())));
    }
}
class Extra {
    static long add(long a, long b) { return a + b; }
}
